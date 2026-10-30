/** Distinguish a real zero from an absent, invalid or simulated measurement. */
export const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
export const percentLabel = value => percent(value) === null ? '—' : `${value}%`;
export function systemMetrics(value) {
    const disk = Number.isSafeInteger(value?.diskFree) && Number.isSafeInteger(value?.diskTotal)
        && value.diskFree >= 0 && value.diskTotal > 0 && value.diskFree <= value.diskTotal;
    return { cpu: percent(value?.cpu), ram: percent(value?.ram),
        diskFree: disk ? value.diskFree : null, diskTotal: disk ? value.diskTotal : null };
}
