import bcrypt from "bcrypt";

export const hash = (value: string) => bcrypt.hash(value, 10);
export const verify = (value: string, hashed: string) => bcrypt.compare(value, hashed);
