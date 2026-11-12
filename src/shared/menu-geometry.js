/** Coordonnées d'une liste absolue à l'intérieur d'un panneau zoomé ou transformé. */
export function menuGeometry(panel) {
    const box = panel.getBoundingClientRect();
    const scaleX = box.width / panel.offsetWidth || 1;
    const scaleY = box.height / panel.offsetHeight || 1;
    return {
        width: panel.clientWidth,
        height: panel.clientHeight,
        rect: rect => ({
            left: (rect.left - box.left) / scaleX - panel.clientLeft,
            right: (rect.right - box.left) / scaleX - panel.clientLeft,
            top: (rect.top - box.top) / scaleY - panel.clientTop,
            bottom: (rect.bottom - box.top) / scaleY - panel.clientTop,
            width: (rect.right - rect.left) / scaleX,
        }),
    };
}
