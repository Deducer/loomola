import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import {
  createPerson,
  deletePerson,
  getPerson,
  listPeople,
  updatePerson,
} from "@/db/queries/people";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

afterEach(async () => {
  if (!process.env.DATABASE_URL) return;
  await db.delete(people).where(eq(people.ownerId, OWNER_A));
  await db.delete(people).where(eq(people.ownerId, OWNER_B));
});

describeDb("people queries", () => {
  it("createPerson inserts a row scoped to owner", async () => {
    const person = await createPerson(OWNER_A, {
      displayName: "Aman",
      email: "aman@example.com",
    });
    expect(person.displayName).toBe("Aman");
    expect(person.ownerId).toBe(OWNER_A);
  });

  it("listPeople returns only the owner's rows", async () => {
    await createPerson(OWNER_A, { displayName: "Aman" });
    await createPerson(OWNER_A, { displayName: "Sara" });
    await createPerson(OWNER_B, { displayName: "Bob" });
    const list = await listPeople(OWNER_A);
    expect(list.map((person) => person.displayName).sort()).toEqual([
      "Aman",
      "Sara",
    ]);
  });

  it("getPerson returns null for a different owner", async () => {
    const person = await createPerson(OWNER_A, { displayName: "Aman" });
    const result = await getPerson(person.id, OWNER_B);
    expect(result).toBeNull();
  });

  it("updatePerson updates display name and email", async () => {
    const person = await createPerson(OWNER_A, { displayName: "Aman" });
    const updated = await updatePerson(person.id, OWNER_A, {
      displayName: "Aman Patel",
      email: "aman@new.com",
    });
    expect(updated?.displayName).toBe("Aman Patel");
    expect(updated?.email).toBe("aman@new.com");
  });

  it("deletePerson removes the row", async () => {
    const person = await createPerson(OWNER_A, { displayName: "Aman" });
    const removed = await deletePerson(person.id, OWNER_A);
    expect(removed).toBe(true);
    const after = await getPerson(person.id, OWNER_A);
    expect(after).toBeNull();
  });

  it("deletePerson does not remove a different owner's row", async () => {
    const person = await createPerson(OWNER_A, { displayName: "Aman" });
    const removed = await deletePerson(person.id, OWNER_B);
    expect(removed).toBe(false);
    const after = await getPerson(person.id, OWNER_A);
    expect(after).not.toBeNull();
  });
});
