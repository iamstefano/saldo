import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleParseExpense } from "./utils/parse-expense.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "10kb" }));
app.use(express.static(root, { dotfiles: "deny" }));
app.post("/api/parse-expense", handleParseExpense);

app.listen(port, () => {
  console.log(`Saldo disponibile su http://localhost:${port}`);
});