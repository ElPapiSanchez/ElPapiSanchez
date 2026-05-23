#!/usr/bin/env node
/**
 * Evenly splits a plain-text name list (one name per line) across Red, Green, Blue, White.
 *
 * Usage:
 *   node scripts/assign-teams.js names.txt > config/people.json
 */

const fs = require("fs");
const TEAMS = ["Red", "Green", "Blue", "White"];

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/assign-teams.js <names.txt>");
  process.exit(1);
}

const names = fs
  .readFileSync(inputPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (names.length === 0) {
  console.error("No names found in file.");
  process.exit(1);
}

const people = names.map((name, i) => ({
  name,
  team: TEAMS[i % TEAMS.length],
}));

process.stdout.write(JSON.stringify(people, null, 2) + "\n");
