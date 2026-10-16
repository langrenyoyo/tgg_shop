// Read a password from stdin and print only its salted scrypt hash.
const { hashAdminPassword } = require("../src/domain/admin-accounts");

if (process.argv[2] !== "--stdin") {
  console.error("Usage: node scripts/hash-password.js --stdin");
  process.exit(2);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const password = input.replace(/\r?\n$/, "");
  if (password.length < 8 || password.length > 128) {
    console.error("Password must be between 8 and 128 characters");
    process.exit(1);
  }
  process.stdout.write(`${hashAdminPassword(password)}\n`);
});

process.stdin.resume();
