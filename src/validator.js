import Ajv from "ajv";
import fs from "fs";

const schema = JSON.parse(
  fs.readFileSync(new URL("../schema/chargeback.schema.json", import.meta.url))
);

const ajv = new Ajv();
export const validateChargeback = ajv.compile(schema);
