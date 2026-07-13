const bcrypt = require("bcryptjs");
const db = require("./queries");

async function main() {
  const email = "demo@codeatlas.dev";
  const password = "password123";

  if (db.findUserByEmail(email)) {
    console.log(`Demo user already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  db.createUser({ email, passwordHash, username: "demo" });

  console.log("✅ Seeded demo user:");
  console.log(`   email:    ${email}`);
  console.log(`   password: ${password}`);
}

main().catch((error) => {
  console.error("❌ Seed failed:", error.message);
  process.exit(1);
});
