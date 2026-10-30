export const MIC_PROFILES_KEY = 'liquid_mic_device_profiles';
export const EMPTY_MIC_PROFILES = { version: 1, profiles: [] };
const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const idValid = value => typeof value === 'string' && value.length <= 2000;
export function micProfileSettings(config) {
    if (!config || !bounded(config.volume, 0, 200) || !bounded(config.balance, -100, 100)
        || !bounded(config.gateThreshold, -80, -10) || !['low', 'normal', 'safe'].includes(config.latency)
        || ['denoise', 'gateEnabled', 'highPass'].some(key => typeof config[key] !== 'boolean')) return null;
    return { volume: config.volume, balance: config.balance, gateThreshold: config.gateThreshold,
        latency: config.latency, denoise: config.denoise, gateEnabled: config.gateEnabled, highPass: config.highPass };
}
export function validMicProfiles(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 32) return false;
    const pairs = new Set();
    return value.profiles.every(profile => {
        if (!profile || !idValid(profile.inputId) || !idValid(profile.outputId) || !micProfileSettings(profile.settings)) return false;
        const key = JSON.stringify([profile.inputId, profile.outputId]);
        if (pairs.has(key)) return false;
        pairs.add(key); return true;
    });
}
export const findMicProfile = (value, inputId = '', outputId = '') => value.profiles.find(profile => profile.inputId === inputId && profile.outputId === outputId);
export function saveMicProfile(value, config) {
    const settings = micProfileSettings(config);
    if (!validMicProfiles(value) || !settings || !idValid(config.inputId ?? '') || !idValid(config.outputId ?? '')) return null;
    const inputId = config.inputId || '', outputId = config.outputId || '';
    const profiles = value.profiles.filter(profile => profile.inputId !== inputId || profile.outputId !== outputId);
    if (profiles.length >= 32) return null;
    return { version: 1, profiles: [...profiles, { inputId, outputId, settings }] };
}
/** Applying a profile cannot start monitoring, even if a backup added an enabled field. */
export const micProfilePatch = profile => {
    const settings = micProfileSettings(profile?.settings);
    return settings ? { ...settings, enabled: false } : null;
};
