const optimizer = require('./optimizer');

const boards = [
    { quality: 'S', length: 100, width: 100, quantity: 50 } // User's hypothetical board
];

const customers = [
    {
        name: 'Test Customer',
        quality: 'S',
        length: 50,
        width: 50,
        height: 20,
        quantity: 2
    }
];

console.log("--- Input ---");
console.log("Board:", boards[0]);
console.log("Order:", customers[0]);

console.log("\n--- Calculating Sheet Size ---");
const L = customers[0].length;
const W = customers[0].width;
const H = customers[0].height;
const glue = 40;
const sheetL = (2 * L) + (2 * W) + glue;
const sheetW = H + W;
console.log(`Sheet Length = (2*${L}) + (2*${W}) + ${glue} = ${sheetL}`);
console.log(`Sheet Width = ${H} + ${W} = ${sheetW}`);

console.log("\n--- Running Optimization ---");
const result = optimizer.calculateOptimization(customers, boards);
console.log(JSON.stringify(result, null, 2));
