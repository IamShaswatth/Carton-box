/**
 * Optimizer Module for Carton Box Manufacturing
 * Calculates optimal board usage (Cutting Stock Problem)
 */

// Constants
const TRIM_MARGIN = 0; // Margin for cuts if needed (can be 0 if perfect cuts assumed)
const SHEET_GLUE_FLAP = 40; // mm

/**
 * Calculates how many sheets can be cut from a board
 * Simplistic 2D area check with Guillotine cut assumption (or just simple tiling)
 * For this version, we will try to fit as many of ONE Type of sheet on a board as possible (simplest industry standard for manual cutting)
 * OR Mix sheets if advanced. The user asked for "Industry Level Optimization".
 * Let's implement a 'Best Fit' rectangle packing.
 */

function calculateOptimization(orders, boards) {
    // 1. Normalize Inputs
    // Group Orders by Quality
    const ordersByQuality = {};
    orders.forEach(order => {
        if (!ordersByQuality[order.quality]) ordersByQuality[order.quality] = [];
        ordersByQuality[order.quality].push(order);
    });

    const results = [];

    // 2. Process each Quality Group
    for (const quality in ordersByQuality) {
        const qualityOrders = ordersByQuality[quality];

        // Filter boards of this quality
        const availableBoards = boards.filter(b => b.quality === quality && b.quantity > 0);

        // Deep copy board quantities so we can decrement as we "use" them
        const boardStock = availableBoards.map(b => ({ ...b }));

        // Convert Orders to Required Sheets
        let allRequiredSheets = [];
        qualityOrders.forEach(order => {
            // RSC Formula
            const sheetL = (2 * order.length) + (2 * order.width) + SHEET_GLUE_FLAP;
            const sheetW = order.height + order.width;

            for (let i = 0; i < order.quantity; i++) {
                allRequiredSheets.push({
                    id: order.id || `${order.customer}-${i}`, // tracking
                    customer: order.customer,
                    sheetL,
                    sheetW,
                    boxL: order.length,
                    boxW: order.width,
                    boxH: order.height,
                    area: sheetL * sheetW // Simplistic area for sorting
                });
            }
        });

        // Sort sheets by Area Descending (Best Fit Decreasing)
        allRequiredSheets.sort((a, b) => b.area - a.area);

        const groupResult = {
            quality,
            produced: [], // { board: {}, cuts: [], utilization: % }
            unproduced: [],
            totalSheets: allRequiredSheets.length
        };

        // packing
        const openBoards = [];

        for (const sheet of allRequiredSheets) {
            let placed = false;

            // 1. Try to fit in existing open boards
            for (const ob of openBoards) {
                // Check if fits in remaining area? 
                // Detailed 2D packing is hard to get right in one go. 
                // Let's use a simpler "Shelf" or "Guillotine" packer logic helper.
                // For this MVP, let's use a simple coordinate tracker or just area check if we want to be lazy (but user asked for industry level).
                // Let's implement a simple recursive packer node.

                const fit = findNode(ob.root, sheet.sheetL, sheet.sheetW);
                if (fit) {
                    ob.cuts.push({
                        ...sheet,
                        x: fit.x,
                        y: fit.y
                    });
                    splitNode(fit, sheet.sheetL, sheet.sheetW);
                    ob.usedArea += (sheet.sheetL * sheet.sheetW);
                    placed = true;
                    break;
                }
            }

            // 2. If not placed, open a new board from stock
            if (!placed) {
                let bestBoardIndex = -1;
                let minWaste = Infinity;

                for (let i = 0; i < boardStock.length; i++) {
                    const b = boardStock[i];
                    if (b.quantity > 0) {
                        // Check if board can fit at least one sheet
                        if ((b.length >= sheet.sheetL && b.width >= sheet.sheetW)) {
                            // Good candidate
                            // Strategy: Use the board that leaves the LEAST waste if we were to only put this one item? 
                            // Or use the Largest to maximize future fits?
                            // Let's use Largest Area First (Best Fit for loose packing usually means matching size, but here we want to fit MANY items).
                            // Actually, standard heuristic: Use the smallest board that fits? Or largest?
                            // Let's just pick the first one that fits for now to ensure we use stock.
                            bestBoardIndex = i;
                            break;
                        }
                    }
                }

                if (bestBoardIndex !== -1) {
                    // Use this board
                    const b = boardStock[bestBoardIndex];
                    b.quantity--;

                    const newOpenBoard = {
                        sourceBoard: { ...b }, // Copy stats
                        root: { x: 0, y: 0, w: b.length, h: b.width },
                        cuts: [],
                        usedArea: 0
                    };

                    // Place the sheet
                    const fit = findNode(newOpenBoard.root, sheet.sheetL, sheet.sheetW);
                    if (fit) {
                        newOpenBoard.cuts.push({
                            ...sheet,
                            x: fit.x,
                            y: fit.y
                        });
                        splitNode(fit, sheet.sheetL, sheet.sheetW);
                        newOpenBoard.usedArea += (sheet.sheetL * sheet.sheetW);
                        openBoards.push(newOpenBoard);
                        placed = true;
                    }
                }
            }

            if (!placed) {
                groupResult.unproduced.push(sheet);
            }
        }

        groupResult.produced = openBoards.map(ob => ({
            boardSize: `${ob.sourceBoard.length}x${ob.sourceBoard.width}`,
            cuts: ob.cuts,
            utilization: ((ob.usedArea / (ob.sourceBoard.length * ob.sourceBoard.width)) * 100).toFixed(2),
            sheetCount: ob.cuts.length
        }));

        results.push(groupResult);
    }

    return results;
}

// Bin Packing Helper Functions (Simple Recursive Guillotine)
function findNode(root, w, h) {
    if (root.used) {
        return findNode(root.right, w, h) || findNode(root.down, w, h);
    } else if ((w <= root.w) && (h <= root.h)) {
        return root;
    } else {
        return null; // Doesn't fit
    }
}

function splitNode(node, w, h) {
    node.used = true;
    // Split: Down is the remaining area below, Right is remaining to the right
    // Heuristic: Split along the shorter axis or longer? 
    // Standard: Split vertically then horizontally.
    node.down = { x: node.x, y: node.y + h, w: node.w, h: node.h - h };
    node.right = { x: node.x + w, y: node.y, w: node.w - w, h: h };
    return node;
}

module.exports = { calculateOptimization };
