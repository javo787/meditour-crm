const { performance } = require('perf_hooks');

async function testPerformance() {
  const MOCK_DELAY = 1000; // 1 second delay

  // Sequential Version
  const startSeq = performance.now();
  await new Promise(r => setTimeout(r, MOCK_DELAY));
  await new Promise(r => setTimeout(r, MOCK_DELAY));
  const endSeq = performance.now();

  // Concurrent Version
  const startPar = performance.now();
  await Promise.all([
    new Promise(r => setTimeout(r, MOCK_DELAY)),
    new Promise(r => setTimeout(r, MOCK_DELAY))
  ]);
  const endPar = performance.now();

  console.log(`Sequential time: ${(endSeq - startSeq).toFixed(2)}ms`);
  console.log(`Concurrent time: ${(endPar - startPar).toFixed(2)}ms`);
}

testPerformance();
