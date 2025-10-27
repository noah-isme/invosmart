import { PrismaClient } from "@prisma/client";
import { hash, verify } from "../lib/hash";

const db = new PrismaClient();

async function main() {
  const email = process.env.EMAIL_TO_CHECK ?? "demo@invosmart.dev";
  const testPassword = process.env.TEST_PASSWORD ?? "password123";

  console.log(`Checking user with email: ${email}`);

  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    console.log("User not found in database.");
    return;
  }

  console.log("User found:", { id: user.id, email: user.email, name: user.name, hasPassword: Boolean(user.password) });

  if (!user.password) {
    console.log("No password set for this user. Setting a test password now (development only):", testPassword);
    const hashed = await hash(testPassword);
    const updated = await db.user.update({ where: { id: user.id }, data: { password: hashed } });
    console.log("Password set for user", { id: updated.id });
  }

  // Re-fetch to get fresh data
  const fresh = await db.user.findUnique({ where: { email } });
  if (!fresh || !fresh.password) {
    console.log("Failed to set or read back the password.");
    return;
  }

  const ok = await verify(testPassword, fresh.password);
  console.log(`Login test with password '${testPassword}':`, ok ? "SUCCESS" : "FAIL");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
