/** Constantes partagées (niveaux d’animation, raccourcis par défaut). */

export const MOTION_LEVELS = ['system', 'sober', 'fluid', 'vivid'];

export const MOTION_LABELS = {
    system: 'Windows',
    sober: 'Sobre',
    fluid: 'Fluide',
    vivid: 'Vivante'
};

export const DEFAULT_CONTROL_SHORTCUTS = [
    { name: "Explorer", preset: "explorer", icon: "ph ph-folder", cmd: "explorer.exe" },
    { name: "Settings", preset: "settings", icon: "ph ph-gear", cmd: "ms-settings:" },
    { name: "TaskMgr", preset: "taskmgr", icon: "ph ph-cpu", cmd: "taskmgr.exe" },
    { name: "Calc", preset: "calc", icon: "ph ph-calculator", cmd: "calc.exe" }
];
