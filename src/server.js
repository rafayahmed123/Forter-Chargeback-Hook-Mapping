import express from "express";
import { mapStripe } from "./mapper.js";
import { validateChargeback } from "./validator.js";

const app = express();
app.use(express.json());

app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body.payload;

    const mappedTransactionData = await mapStripe(payload);

    const isValid = validateChargeback(mappedTransactionData);
    if (!isValid) {
      return res.status(400).json({ errors: validateChargeback.errors });
    }

    res.json({ result: mappedTransactionData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;

if (process.env.NODE_ENV !== "test") {
  app.listen(3000, () =>
    console.log("Server running on http://localhost:3000")
  );
}
