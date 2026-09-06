import { toPng } from 'html-to-image';
import { Node, getRectOfNodes, getTransformForBounds } from 'reactflow';

/** Blank margin around the diagram so nodes do not touch the edge of the image. */
const PADDING = 48;

/** Keeps a very large schema from producing an unmanageable file. */
const MAX_DIMENSION = 4096;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/**
 * Downloads the schema canvas as a PNG.
 *
 * <p>The image is sized to the diagram's own bounding box rather than to the visible pane, so the
 * whole schema is captured however the user happens to be scrolled or zoomed. React Flow renders
 * every node into the DOM (virtualisation is off), so nothing off-screen is missing.
 */
export const downloadCanvasImage = async (nodes: Node[], fileName: string): Promise<void> => {
    if (nodes.length === 0) {
        throw new Error('There are no tables to export yet.');
    }

    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) {
        throw new Error('The diagram is not ready yet. Try again in a moment.');
    }

    const bounds = getRectOfNodes(nodes);
    const width = Math.min(MAX_DIMENSION, Math.max(MIN_WIDTH, Math.ceil(bounds.width) + PADDING * 2));
    const height = Math.min(MAX_DIMENSION, Math.max(MIN_HEIGHT, Math.ceil(bounds.height) + PADDING * 2));
    const [x, y, zoom] = getTransformForBounds(bounds, width, height, 0.5, 2);

    const dataUrl = await toPng(viewport, {
        backgroundColor: '#ffffff',
        width,
        height,
        // pixelRatio 2 keeps the small 9px column labels legible when the image is zoomed.
        pixelRatio: 2,
        cacheBust: true,
        style: {
            width: `${width}px`,
            height: `${height}px`,
            transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        },
    });

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = toPngFileName(fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/** `orders.sql` -> `orders.png`; anything else just gains the extension. */
const toPngFileName = (fileName: string): string => {
    const base = (fileName || 'schema').replace(/\.(sql|csv)$/i, '');
    return `${base || 'schema'}.png`;
};
