import { handleParseExpense } from "../utils/parse-expense.js";

export default async function handler(req, res) {
  return handleParseExpense(req, res);
}