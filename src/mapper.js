import jsonata from "jsonata";
import fs from "fs";

const stripeExpression = jsonata(
  fs.readFileSync("./src/providers/stripe.jsonata", "utf8")
);

export async function mapStripe(payload) {
  return stripeExpression.evaluate(payload);
}
