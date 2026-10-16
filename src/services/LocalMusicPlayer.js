/** Le son vit dans l'Island, indépendamment de la fenêtre Bibliothèque. */
export class LocalMusicPlayer {
    constructor({ invoke, listen, fileSrc, onMedia, onError, audio = new Audio(), storage = localStorage, random = Math.random }) {
        Object.assign(this, { invoke, listen, fileSrc, onMedia, onError, audio, storage, random });
        this.library = { tracks: [], playlists: [] };
        this.queue = [];
        this.active = false;
        this.currentId = '';
        this.error = '';
        this.shuffle = false;
        this.repeat = 'off';
        this.playToken = 0;
        this.shufflePlayed = new Set();
        try {
            const prefs = JSON.parse(storage.getItem('nolys_library_player') || '{}');
            audio.volume = Number.isFinite(prefs.volume) ? Math.max(0, Math.min(1, prefs.volume)) : 0.8;
            this.shuffle = prefs.shuffle === true;
            this.repeat = ['off', 'all', 'one'].includes(prefs.repeat) ? prefs.repeat : 'off';
        } catch { audio.volume = 0.8; }
        audio.preload = 'metadata';
        for (const event of ['play', 'pause', 'loadedmetadata', 'seeked', 'volumechange']) audio.addEventListener(event, () => this.publish());
        audio.addEventListener('timeupdate', () => { if (Date.now() - (this.lastPublish || 0) > 450) this.publish(); });
        audio.addEventListener('ended', () => this.next(true).catch(error => this.fail(error)));
        audio.addEventListener('error', () => {
            if (this.active) this.fail(new Error('Lecture impossible. Le fichier est indisponible ou son format audio n’est pas lisible.'));
        });
    }

    async init() {
        await this.listen('local-library-control', action => this.control(action).catch(error => this.fail(error)));
        await this.listen('local-library-changed', () => this.reload().catch(error => this.fail(error)));
        await this.reload();
        this.publish();
    }

    async reload() {
        this.library = await this.invoke('library_get');
        const known = new Set(this.library.tracks.map(track => track.id));
        this.queue = this.queue.filter(id => known.has(id));
        if (this.currentId && !known.has(this.currentId)) this.stop();
        else if (this.active) this.publish();
    }

    get current() { return this.library.tracks.find(track => track.id === this.currentId); }

    get snapshot() {
        const duration = Number.isFinite(this.audio.duration) ? this.audio.duration * 1000 : this.current?.duration || 0;
        return { active: this.active, trackId: this.currentId, isPlaying: this.active && !this.audio.paused && !this.audio.ended,
            progress: this.audio.currentTime * 1000 || 0, duration, volume: this.audio.volume,
            shuffle: this.shuffle, repeat: this.repeat, queue: [...this.queue], error: this.error };
    }

    get media() {
        const track = this.current;
        if (!this.active || !track) return null;
        const state = this.snapshot;
        return { title: track.title, artist: track.artist, cover: this.fileSrc(track.cover), transientCover: '',
            isPlaying: state.isPlaying, progress: state.progress, duration: state.duration,
            appId: 'nolys-local', source: 'local', trackKey: `local:${track.id}`, localTrackId: track.id };
    }

    publish() {
        this.lastPublish = Date.now();
        this.onMedia(this.media);
        this.invoke('library_set_playback', { playback: this.snapshot }).catch(() => {});
    }

    fail(error) {
        this.error = String(error?.message || error);
        this.audio.pause();
        this.publish();
        this.onError(this.error);
    }

    async play(id, queue) {
        const token = ++this.playToken;
        try {
            const track = this.library.tracks.find(track => track.id === id);
            if (!track) throw new Error('Ce morceau n’est plus dans la bibliothèque.');
            await this.invoke('library_check_track', { id });
            if (token !== this.playToken) return;
            if (!this.active) await this.invoke('media_control', { action: 'pause' });
            if (token !== this.playToken) return;
            const known = new Set(this.library.tracks.map(track => track.id));
            if (queue) {
                this.queue = [...new Set(queue)].filter(id => known.has(id));
                this.shufflePlayed.clear();
            }
            if (!this.queue.includes(id)) this.queue = [id, ...this.queue];
            this.error = '';
            this.active = true;
            this.shufflePlayed.add(id);
            const source = this.fileSrc(track.path);
            if (this.currentId !== id || this.currentSource !== source || !this.audio.src) {
                this.currentId = id;
                this.currentSource = source;
                this.audio.src = source;
            } else this.audio.currentTime = 0;
            this.publish();
            await this.audio.play();
        } catch (error) {
            if (token === this.playToken) throw error;
        }
    }

    stop() {
        ++this.playToken;
        this.active = false;
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.currentId = '';
        this.currentSource = '';
        this.queue = [];
        this.error = '';
        this.publish();
    }

    async next(ended = false) {
        if (ended && this.repeat === 'one' && this.currentId) return this.play(this.currentId);
        const playable = this.queue.filter(id => this.library.tracks.some(track => track.id === id && !track.missing));
        if (!playable.length) { this.audio.pause(); this.publish(); return; }
        let id;
        if (this.shuffle) {
            let choices = playable.filter(id => id !== this.currentId && !this.shufflePlayed.has(id));
            if (!choices.length && (!ended || this.repeat === 'all')) {
                this.shufflePlayed.clear();
                this.shufflePlayed.add(this.currentId);
                choices = playable.filter(id => id !== this.currentId);
            }
            id = choices[Math.floor(this.random() * choices.length)];
            if (!id && (!ended || this.repeat === 'all')) id = playable[0];
        } else {
            id = playable[playable.indexOf(this.currentId) + 1];
            if (!id && (!ended || this.repeat === 'all')) id = playable[0];
        }
        if (id) await this.play(id);
        else this.publish();
    }

    async control(command) {
        if (!command || typeof command !== 'object') return;
        const state = this.snapshot;
        switch (command.type) {
            case 'play': await this.play(command.id, command.queue); break;
            case 'stop': this.stop(); break;
            case 'seek': {
                const ms = Number(command.value);
                if (this.active && Number.isFinite(ms)) this.audio.currentTime = Math.max(0, Math.min(state.duration / 1000, ms / 1000));
                this.publish(); break;
            }
            case 'volume': {
                const volume = Number(command.value);
                if (Number.isFinite(volume)) this.audio.volume = Math.max(0, Math.min(1, volume));
                this.savePreferences(); this.publish(); break;
            }
            case 'shuffle': this.shuffle = !this.shuffle; this.savePreferences(); this.publish(); break;
            case 'repeat': this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat]; this.savePreferences(); this.publish(); break;
            case 'queue': {
                const known = new Set(this.library.tracks.map(track => track.id));
                if (Array.isArray(command.ids)) this.queue = [...new Set(command.ids)].filter(id => known.has(id));
                this.publish(); break;
            }
            case 'media': {
                if (!this.active) return;
                const action = String(command.action || '');
                if (action.startsWith('seek ')) return this.control({ type: 'seek', value: Number(action.slice(5)) });
                if (action === 'next') return this.next();
                if (action === 'prev') {
                    if (this.audio.currentTime > 3) { this.audio.currentTime = 0; this.publish(); }
                    else await this.play(this.queue[Math.max(0, this.queue.indexOf(this.currentId) - 1)] || this.currentId);
                } else if (action === 'pause' || (action === 'toggle' && state.isPlaying)) this.audio.pause();
                else if (action === 'play' || action === 'toggle') { this.error = ''; await this.audio.play(); }
                break;
            }
        }
    }

    savePreferences() {
        try { this.storage.setItem('nolys_library_player', JSON.stringify({ volume: this.audio.volume, shuffle: this.shuffle, repeat: this.repeat })); } catch { /* La lecture reste possible si le stockage est plein. */ }
    }
}
