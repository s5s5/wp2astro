const fs = require("fs");
const path = require("path");

const inputPath = path.resolve(__dirname, "../../temp/t.json");
const outputPath = path.resolve(__dirname, "../../temp/match_counts.json");

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(2);
  }

  let raw;
  try {
    raw = await fs.promises.readFile(inputPath, "utf8");
  } catch (err) {
    console.error("Failed to read input file:", err.message);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse JSON:", err.message);
    process.exit(2);
  }

  const counts = new Map();
  const samples = Array.isArray(data.samples) ? data.samples : [];
  for (const sample of samples) {
    if (!Array.isArray(sample.matches)) continue;
    for (const m of sample.matches) {
      const key = String(m.match);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const sorted = Array.from(counts.entries())
    .map(([match, count]) => ({ match, count }))
    .sort((a, b) => b.count - a.count || a.match.localeCompare(b.match));

  // Print a readable list
  console.log("Match counts (sorted):");
  for (const { match, count } of sorted) {
    console.log(`${count.toString().padStart(4)}  ${match}`);
  }

  // Save JSON file for further inspection
  try {
    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(sorted, null, 2),
      "utf8"
    );
    console.log(`\nWrote counts to ${outputPath}`);
  } catch (err) {
    console.error("Failed to write output file:", err.message);
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
