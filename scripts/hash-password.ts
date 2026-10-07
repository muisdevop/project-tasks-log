import bcrypt from "bcryptjs";

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npm run password:hash -- <plain-password>");
    process.exit(1);
  }
  // Must match BCRYPT_COST in src/lib/auth.ts (SEC-10): a hash generated below
  // that cost is re-hashed on first login, so produce a compliant one directly.
  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
