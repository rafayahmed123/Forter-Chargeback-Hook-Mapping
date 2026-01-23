# Forter Webhook Mapper

A declarative webhook transformation service that maps payment provider chargeback webhooks into Forter's normalized schema using JSONata expressions.

# Key Goals

- Minimize custom engineering per merchant
- Support platform-scale integrations (one provider → many merchants)
- Provide strong governance, validation, and auditability
- Reduce onboarding risk for enterprise contracts

## Quick Start

### Installation

```bash
npm install
```

### Run Server

```bash
npm start
```

Server runs on `http://localhost:3000`

### Run Tests

```bash
npm test
```

## API Usage

### Endpoint

```
POST /webhook
```

### Request

```json
{
  "payload": {
    "id": "evt_123",
    "type": "charge.dispute.created",
    "data": {
      "object": {
        "amount": 2599,
        "currency": "usd",
        "reason": "fraudulent",
        "charge": "ch_98765"
      }
    }
  }
}
```

### Response

```json
{
  "result": {
    "transaction_id": "ch_98765",
    "reason": "fraudulent",
    "currency": "USD",
    "amount": 25.99,
    "provider": "stripe"
  }
}
```

## E2E Testing

### Test Stripe Webhook

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "id": "evt_123",
      "type": "charge.dispute.created",
      "data": {
        "object": {
          "amount": 2599,
          "currency": "usd",
          "reason": "fraudulent",
          "charge": "ch_98765"
        }
      }
    }
  }'
```

Expected output:

```json
{
  "result": {
    "transaction_id": "ch_98765",
    "reason": "fraudulent",
    "currency": "USD",
    "amount": 25.99,
    "provider": "stripe"
  }
}
```

### Test with Invalid Data

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "data": {
        "object": {
          "amount": 1000
        }
      }
    }
  }'
```

Expected error (missing required fields):

```json
{
  "errors": [
    {
      "instancePath": "",
      "message": "must have required property 'transaction_id'"
    }
  ]
}
```

# Design & Architecture

## 1. Extensibility: Onboarding New Providers

### Current Design

The system uses a **file-based provider registry** where each provider's mapping logic is isolated in a single JSONata file. This approach minimizes engineering effort when adding new providers.

### Adding a New Provider (3 Steps)

**Step 1: Create mapping file**

```jsonata
// src/providers/paypal.jsonata
{
  "transaction_id": resource.dispute_transactions[0].seller_transaction_id,
  "reason": resource.reason,
  "currency": resource.dispute_amount.currency_code,
  "amount": $number(resource.dispute_amount.value),
  "provider": "paypal"
}
```

**Step 2: Update mapper.js**

```javascript
import paypalExpression from "./providers/paypal.jsonata";
const paypal = jsonata(paypalExpression);

export async function mapPayPal(payload) {
  return paypal.evaluate(payload);
}
```

**Step 3: Add route handler**

```javascript
// In server.js - add provider detection or explicit routing
```

### Scalable Extensibility Design

For production, I would implement a **provider registry pattern**:

```javascript
// Registry automatically loads all providers
class ProviderRegistry {
  constructor() {
    this.loadProviders("./src/providers/");
  }

  loadProviders(dir) {
    // Auto-discover all .jsonata files
    // Compile and cache expressions
    // Provider name = filename
  }

  getProvider(name) {
    return this.providers.get(name);
  }
}
```

**Benefits:**

- **Zero code changes**: Drop a `.jsonata` file → provider is available
- **Convention over configuration**: Filename = provider name
- **Hot reloading**: Watch directory for changes in dev mode
- **Minimal engineering effort**: ~5 minutes per provider vs hours of coding

### For Enterprise Scale

**Database-backed mappings:**

```sql
CREATE TABLE provider_mappings (
  provider VARCHAR(50) PRIMARY KEY,
  jsonata_expression TEXT NOT NULL,
  version INT DEFAULT 1,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP,
  updated_by VARCHAR(100)
);
```

This enables:

- Runtime updates without deployment
- A/B testing different mappings
- Per-merchant custom mappings
- Audit trail and rollback capability

---

## 2. Developer Experience: Testing Tooling

Merchants need confidence before going live. I would expose **three layers of testing tools**:

### Layer 1: API-Based Testing Endpoint

```javascript
POST /webhook/test
{
  "payload": { /* sample webhook */ },
  "provider": "stripe",
  "expression": "{ /* optional custom JSONata */ }"
}

Response:
{
  "success": true,
  "result": { /* transformed data */ },
  "validation": {
    "valid": true,
    "errors": null
  },
  "warnings": []
}
```

**Features:**

- Test transformations without affecting production
- Validate custom expressions before deployment
- Preview output before committing
- No credentials or setup required

### Layer 2: Interactive Web UI

**Merchant Self-Service Portal:**

```
Webhook Mapping Tester

1. Select Provider: [Stripe ▼]

2. Paste Sample Webhook:
    {
      "type": "charge.dispute.created",
      "data": { ... }
    }
3. Preview Transformation:
 ✓ transaction_id: "ch_12345"
 ✓ reason: "fraudulent"
 ✓ currency: "USD"
 ✓ amount: 25.99
 ✓ provider: "stripe"
 ✓ All required fields present
 ✓ Schema validation passed

  [Download Test Case] [Go Live →]
```

**Implementation:**

- React SPA with Monaco editor (VS Code component)
- Real-time validation as they type
- Library of sample webhooks per provider
- "Quick Start" templates for common providers

### Layer 3: CLI Tool for Engineers

```bash
# Install CLI
npm install -g @forter/webhook-mapper-cli

# Test a mapping locally
forter-mapper test \
  --provider stripe \
  --payload sample-webhooks/stripe-dispute.json

# Validate custom expression
forter-mapper validate \
  --expression custom-mapping.jsonata

# Generate test fixtures
forter-mapper generate-tests --provider stripe
```

**Benefits:**

- CI/CD integration
- Local development workflow
- Automated regression testing
- Version control for mappings

### Tooling Priorities

| Tool     | Priority | User       | Use Case                |
| -------- | -------- | ---------- | ----------------------- |
| Test API | P0       | Developers | Quick validation        |
| Web UI   | P1       | Merchants  | Self-service onboarding |
| CLI      | P2       | Engineers  | CI/CD & automation      |

---

## 3. Safety and Maintainability

### Sandboxing Strategy

**JSONata's Built-in Safety:**

- ✓ No arbitrary code execution (`eval`, `Function()`)
- ✓ No file system access
- ✓ No network calls
- ✓ Pure functional transformations
- ✓ Deterministic output

**Additional Safeguards:**

```javascript
// Timeout protection
const expression = jsonata(mapping, {
  timeout: 1000,
});

// Memory limits
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024; // 5MB
if (JSON.stringify(payload).length > MAX_PAYLOAD_SIZE) {
  throw new Error("Payload too large");
}

// Expression complexity limits
const MAX_EXPRESSION_LENGTH = 10000; // 10KB expression size
```

- **Runtime Isolation:**

- Each evaluation runs in a clean context
- No shared state between requests
- Errors don't crash the service
- Resource limits prevent DoS

### Version Management

**Semantic Versioning for Mappings:**

```
providers/
  stripe/
    v1.0.0.jsonata    # Initial version
    v1.1.0.jsonata    # Added optional field
    v2.0.0.jsonata    # Breaking change (field renamed)
  paypal/
    v1.0.0.jsonata
```

**Per-Merchant Version Pinning:**

```javascript
{
  "merchant_id": "merchant_abc",
  "provider": "stripe",
  "mapping_version": "v1.0.0",  // Pinned to stable version
  "auto_upgrade": false          // Manual approval required
}
```

**Migration Path:**

1. New version deployed as `v2.0.0`
2. Existing merchants stay on `v1.0.0`
3. Deprecation notice sent (90-day window)
4. Merchants test v2 in staging
5. Merchants opt-in to upgrade
6. v1 sunset after all migrations

### Breaking Change Detection

**Automated Contract Testing:**

```javascript
// Golden test - ensure backward compatibility
describe("Stripe v2 compatibility", () => {
  const v1Results = runMapping("stripe/v1.0.0", testCases);
  const v2Results = runMapping("stripe/v2.0.0", testCases);

  it("produces same core fields as v1", () => {
    expect(v2Results.transaction_id).toBe(v1Results.transaction_id);
    expect(v2Results.amount).toBe(v1Results.amount);
    // New fields in v2 are OK, changed fields are breaking
  });
});
```

**Schema Diff Tool:**

```bash
# Compare two versions
forter-mapper diff \
  --from stripe/v1.0.0 \
  --to stripe/v2.0.0

Output:
✓ transaction_id: unchanged
✓ amount: unchanged
⚠ currency: renamed to currency_code (BREAKING)
✓ new field: chargeback_date (OK)
```

**Pre-deployment Checks:**

1. Run all existing test cases against new version
2. Compare output schemas
3. Flag any removed/renamed fields
4. Require manual approval for breaking changes

### Monitoring & Alerting

**Key Metrics:**

- Mapping success rate per provider
- Validation failure rate
- Expression evaluation time (p50, p99)
- Error types by provider

**Alerts:**

- Validation failure rate > 5%
- Expression timeout > 1%
- New error types detected
- Provider mapping not found

---

## 4. GTM Integration: Accelerating Merchant Onboarding

### Current Merchant Onboarding Pain Points

**Traditional Approach With Example Timeframes:**

1. Merchant sends webhook samples → 2 days
2. Engineering writes custom mapping → 3-5 days
3. QA testing → 2 days
4. Deploy to production → 1 day
5. Monitor for issues → 1-2 weeks

**Total: 2-3 weeks per merchant**

### Proposed Self-Service Onboarding

**Week 1 → Day 1:**

```
Merchant Portal Workflow:

 1. Select your payment provider
    [Stripe] [PayPal] [Custom]

 2. Test with sample webhook
    (Paste or upload JSON)
    → Instant validation

3. Verify mapped output
    ✓ All fields mapped correctly

 4. Go live
    [Activate Integration]
```

**Self-service enables:**

- Merchant tests own webhooks immediately
- No engineering involvement for standard providers
- Live in hours instead of weeks
- Engineering only involved for custom/complex cases

### Key Metrics to Track

#### Onboarding Efficiency

| Metric                               | Example Target | Why It Matters                |
| ------------------------------------ | -------------- | ----------------------------- |
| **Time to first successful mapping** | < 5 minutes    | Measures UX friction          |
| **Self-service completion rate**     | > 80%          | % who go live without support |
| **Engineering escalation rate**      | < 20%          | % requiring custom work       |
| **Average onboarding time**          | < 24 hours     | Speed to revenue              |

#### System Health

| Metric                   | Example Target | Alert Threshold          |
| ------------------------ | -------------- | ------------------------ |
| **Mapping success rate** | > 99%          | < 95%                    |
| **Validation pass rate** | > 95%          | < 90%                    |
| **P99 latency**          | < 100ms        | > 500ms                  |
| **Provider coverage**    | All top 10     | Missing provider request |

#### Business Impact

- **Merchants onboarded per week**: Track velocity
- **Support tickets per merchant**: Measure quality
- **Time to revenue**: From signup to first transaction
- **Merchant satisfaction (NPS)**: Survey after onboarding

### GTM Enablement Features

**1. Provider Marketplace**

```
Popular Providers:
[Stripe]    [PayPal]    [Adyen]     [Square]
Ready to use            1-click setup

Coming Soon:
[Braintree] [Checkout.com]
Request early access →
```

**2. Onboarding Analytics Dashboard**

```
Last 30 Days:
├─ 47 merchants onboarded
├─ 92% self-service (no support needed)
├─ Avg time to live: 18 minutes
└─ 3 new provider requests (Klarna, Afterpay, Affirm)
```

---

## 5. Future Enhancements & Roadmap

**Goal: Establish a production-ready foundation for fast provider webhook onboarding**

### Phase 1: Foundation

- ✓ Core JSONata transformation engine
- ✓ Schema validation
- ✓ Stripe support
- ✓ Basic error handling
- ✓ Unit tests

### Phase 2: Extensibility

**Goal: Support top 5 payment providers**

**Multi-Provider Support**

- [ ] Provider registry pattern implementation
- [ ] PayPal mapping
- [ ] Adyen / other provider mappings
- [ ] Auto-discovery of provider files
- [ ] Provider-specific test suites

**Developer Tooling**

- [ ] `/webhook/test` endpoint for safe testing
- [ ] Expression validation API
- [ ] Sample webhook library
- [ ] Error messaging improvements

**Metrics to Hit:**

- 5 providers supported
- < 30 min to add new provider
- 95% test coverage

### Phase 3: Self-Service

**Goal: Merchants can onboard without engineering**

**Features:**

- [ ] Web UI for testing mappings
- [ ] Provider selector and templates
- [ ] Real-time validation feedback
- [ ] Sample webhook library per provider
- [ ] Documentation generator

**Metrics to Hit:**

- 70% self-service rate
- < 1 hour average onboarding time
- < 5% support escalation rate

### Phase 4: Enterprise Scale

**Goal: Production-grade reliability and governance**

**Governance:**

- [ ] Mapping version management
- [ ] A/B testing framework
- [ ] Rollback capabilities
- [ ] Audit logging
- [ ] Per-merchant custom mappings

**Reliability:**

- [ ] Rate limiting
- [ ] Circuit breakers
- [ ] Monitoring and alerting
- [ ] Caching
- [ ] Multi-region deployment

**Metrics to Hit:**

- 99.9% uptime SLA
- < 50ms p99 latency
- Support 1000+ merchants

### Phase 5: Advanced Features

**Based on merchant feedback:**

**Potential Features:**

- Custom field transformations (e.g., PII redaction)
- Webhook enrichment (add merchant metadata)
- Real-time webhook replay for testing
- ML-powered anomaly detection

### Decision Criteria for Next Steps

After Phase 1, I would decide next steps based on:

**1. Merchant Data**

- Which providers are most requested?
- What % of onboardings require engineering help?
- What are common failure modes?

**2. Business Priorities**

- Is GTM focused on enterprise (governance) or SMB (self-service)?
- What's the target number of merchants in 6 months?
- Are there partnership opportunities (e.g., Stripe App Marketplace)?

**3. Technical Debt**

- What's the error rate in production?
- Are there performance bottlenecks?
- How much manual support is required?

### Long-term Vision 

**The North Star:**
Any merchant can integrate with Forter in < 5 minutes without touching code.

**Strategic Themes:**

1. **Zero-touch onboarding**: AI-powered mapping generation
2. **Ecosystem plays**: Pre-built integrations in partner marketplaces
3. **Platform expansion**: Support non-chargeback webhooks (fraud, refunds, etc.)
4. **Data intelligence**: Use webhook data for insights and anomaly detection

---

## Summary

This webhook mapping system is designed with **extensibility at its core**. By using JSONata expressions as declarative configuration, we separate mapping logic from application code, enabling rapid onboarding of new providers.

The path forward focuses on:

1. **Self-service tooling** to reduce engineering bottlenecks
2. **Governance features** to support enterprise scale
3. **Data-driven decisions** to prioritize what merchants actually need

The goal is to transform merchant onboarding from a weeks-long engineering project into a minutes-long self-service experience.
