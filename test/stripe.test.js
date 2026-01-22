import request from "supertest";
import app from "../src/server.js";

test("Stripe dispute webhook maps to Forter schema", async () => {
  const payload = {
    id: "evt_123",
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_12345",
        amount: 2599,
        currency: "usd",
        reason: "fraudulent",
        charge: "ch_98765",
      },
    },
  };

  const res = await request(app).post("/webhook").send({ payload });

  expect(res.body.result).toEqual({
    transaction_id: "ch_98765",
    reason: "fraudulent",
    currency: "USD",
    amount: 25.99,
    provider: "stripe",
  });
});
