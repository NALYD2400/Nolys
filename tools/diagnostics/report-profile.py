"""Rapport descriptif d'une mesure native terminée, sans confondre CPU machine et cœur."""
import argparse
import json
from pathlib import Path
from statistics import median

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path)
parser.add_argument("--plot", action="store_true", help="Requiert matplotlib dans l'environnement Python existant.")
parser.add_argument("--allow-short", action="store_true", help="Rapport explicitement limité après un arrêt demandé, sans prétendre à une heure complète.")
args = parser.parse_args()
directory = args.directory.resolve()
summary = json.loads((directory / "summary.json").read_text(encoding="utf-8-sig"))
progress = json.loads((directory / "progress.json").read_text(encoding="utf-8-sig"))
rows = [json.loads(line) for line in (directory / "process-metrics.ndjson").read_text(encoding="utf-8-sig").splitlines() if line.strip()]
if progress.get("invalid") or len(summary["stages"]) != 8 and not (args.allow_short and summary.get("stopReason")):
    raise ValueError("La mesure doit être terminée et valide avant de produire ce rapport.")
stages = summary["stages"]
soak = next(s for s in stages if s["name"] == "soak-music")
if soak["ended"] - soak["started"] < 3600000 and not (args.allow_short and summary.get("stopReason")):
    raise ValueError("L'observation prolongée doit couvrir au moins une heure.")
samples = [r for r in rows if soak["started"] + 5000 <= r["time"] <= soak["ended"]]
first = [r["privateMiB"] for r in samples if r["time"] < soak["started"] + 600000]
last = [r["privateMiB"] for r in samples if r["time"] > soak["ended"] - 600000]
if len(first) < 30 or len(last) < 30:
    raise ValueError("Couverture insuffisante des fenêtres de début/fin.")
heap = [h for h in summary["heap"] if h["stage"] == "soak-music"]
labels = {"idle": "Repos initial", "music-compact": "Musique compacte", "music-expanded": "Lecteur ouvert", "settings": "Réglages", "control": "Contrôle", "economy-music": "Musique en économie", "soak-music": "Musique · une heure", "idle-after-soak": "Repos final"}
observed_minutes = (soak["ended"] - soak["started"]) / 60000
labels['soak-music'] = f"Musique · {observed_minutes:.1f} min"
lines = ["# Mesure native de Nolys", "", f"Binaire debug embarqué, SHA-256 `{summary['manifest']['sha256']}`. {summary['logicalProcessors']} processeurs logiques.", "", "Ces valeurs décrivent cette session et cette machine. Le fichier audio est silencieux et muet ; les niveaux audio système des autres applications ne sont pas contrôlés. Elles ne constituent pas une mesure d'une release, d'une capture de jeu ou d'un poste isolé des autres applications.", "", "| État | Durée | Échantillons | CPU machine moyenne | CPU un cœur moyenne | Mémoire privée moyenne | Pic privé |", "|---|---:|---:|---:|---:|---:|---:|"]
for s in stages:
    lines.append(f"| {labels[s['name']]} | {(s['ended']-s['started'])/1000:.0f} s | {s['count']} | {s['averageCpuMachinePercent']:.2f} % | {s['averageCpuOneCorePercent']:.2f} % | {s['averagePrivateMiB']:.1f} Mio | {s['peakPrivateMiB']:.1f} Mio |")
if summary.get('stopReason'):
    lines += ['', f"Observation arrêtée après {observed_minutes:.1f} minutes : {summary['stopReason']}. Le retour final au repos n'a pas été mesuré ; aucune heure complète n'est revendiquée."]
lines += ["", "100 % CPU « un cœur » correspond à un processeur logique occupé. La colonne machine divise cette valeur par le nombre de processeurs logiques. La mémoire privée additionne le processus natif et ses descendants WebView2 ; le working set, qui partage des pages entre processus, n'est pas assimilé à de la mémoire unique.", "", "## Observation prolongée", "", f"La médiane de mémoire privée des dix premières minutes vaut {median(first):.1f} Mio ; celle des dix dernières vaut {median(last):.1f} Mio, soit {median(last)-median(first):+.1f} Mio. Le maximum observé pendant cette phase est {max(r['privateMiB'] for r in samples):.1f} Mio. Les pics ponctuels et l'évolution des médianes sont présentés séparément."]
if heap:
    lines += ["", f"Le tas JavaScript utilisé va de {min(h['JSHeapUsedSize'] for h in heap)/1048576:.1f} à {max(h['JSHeapUsedSize'] for h in heap)/1048576:.1f} Mio ; le nombre de nœuds DOM va de {min(h['Nodes'] for h in heap):.0f} à {max(h['Nodes'] for h in heap):.0f}. Ces compteurs du rendu ne représentent pas la mémoire des textures, des décodeurs et du processus GPU."]
gpu = [r["gpu3dEnginePercentSum"] for r in samples if r["gpuAvailable"]]
lines += ["", f"GPU : {len(gpu)} échantillons avec compteur 3D disponible" + (f", maximum {max(gpu):.2f} %." if gpu else ". Aucun zéro n'est substitué à un compteur absent."), "Les compteurs peuvent être arrondis. Ils n'incluent pas la composition du bureau par DWM ; un zéro ne prouve pas l'absence de travail graphique.", "", "## Interprétation et limites", "", "Une hausse pendant une observation limitée ne suffit pas à établir une fuite ; une stabilité sur cette durée ne prouve pas son absence dans tous les scénarios. Les courbes servent à repérer une dérive à investiguer, puis à la relier aux vues et aux processus. La comparaison initial/final inclut le chargement des modules, les caches et les ressources conservées par WebView2.", ""]
for limit in summary["limitations"]:
    if limit.startswith("WAV silencieux"):
        limit = "WAV silencieux local et muet ; les niveaux audio système des autres applications ne sont pas contrôlés."
    lines.append(f"- {limit}")
if args.plot:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    start = rows[0]["time"]
    minutes = [(r["time"]-start)/60000 for r in rows]
    fig, axes = plt.subplots(3, 1, figsize=(11, 8), sharex=True, layout="constrained")
    axes[0].plot(minutes, [r["privateMiB"] for r in rows], linewidth=.9, color="#7256bc")
    axes[0].set_ylabel("Mémoire privée (Mio)")
    axes[1].plot(minutes, [r["cpuMachinePercent"] for r in rows], linewidth=.8, color="#167fb5")
    axes[1].set_ylabel("CPU machine (%)")
    axes[2].plot([(h["time"]-start)/60000 for h in summary["heap"]], [h["JSHeapUsedSize"]/1048576 for h in summary["heap"]], linewidth=.8, color="#00846b")
    axes[2].set_ylabel("Tas JS utilisé (Mio)")
    axes[2].set_xlabel("Temps depuis le premier échantillon (minutes)")
    for ax in axes:
        ax.set_ylim(bottom=0)
        ax.grid(alpha=.2)
        ax.axvspan((soak["started"]-start)/60000, (soak["ended"]-start)/60000, color="#ddd5ef", alpha=.22)
    fig.suptitle(f"Nolys · diagnostic debug natif et descendants WebView2\nZone teintée : {observed_minutes:.1f} min de musique compacte, WAV silencieux")
    fig.savefig(directory / "profile.png", dpi=160)
    plt.close(fig)
    lines += ["", "![Mémoire et CPU pendant la session](profile.png)"]
(directory / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(json.dumps({"report": str(directory / "report.md"), "soakMedianStartMiB": median(first), "soakMedianEndMiB": median(last), "samples": len(rows)}))
