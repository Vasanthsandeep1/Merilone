'use strict';

// Ported verbatim from the OLD tender-automation site's
// (Openprocure 2.0/AUTOMATION SITE/openprocure_2.0)
// backend/src/controllers/deviationRepresentation.controller.js ->
// generateRepresentationLetter. Drafts a positive, convincing "why our
// deviation should be accepted" letter for each Not-Complied/Deviation row,
// grounded in the actual tender document text where possible.

const SYSTEM_PROMPT = 'You are a professional tender response writer. Generate positive, convincing representation letters that highlight how products meet tender requirements.';

function buildUserPrompt({ resolvedProductName, productCode, notCompliedRows, productSpec, bidDocText }) {
  const bidDocSection = bidDocText
    ? `\nActual tender bid document text (ground your reasoning in this — reference exact tender clauses where possible):\n"""\n${bidDocText}\n"""\n`
    : '';

  return `Create a representation letter for the deviation table. I need the representation with a table type of columns:
- Specification
- Tender Requirement
- Product Offered
- Reason
- Justification
- Representation

Provide as JSON array. The representation should be positive, showing how our suggested product matches their requirements and will fit. Be professional and convincing.

Our Product Name: ${resolvedProductName}
Our Product Code: ${productCode}

Deviation rows that require representation (Not Complied only):
${JSON.stringify(notCompliedRows, null, 2)}

The product I suggested with full specifications:
${JSON.stringify({ ...productSpec, _resolved_product_name: resolvedProductName }, null, 2)}
${bidDocSection}
IMPORTANT: Throughout the representation text, always refer to the product as "${resolvedProductName}" (not any other name from the specs). For the "product_offered" column, copy the value exactly as given in each row's own "product_offered" field from the deviation rows above — do not replace it with the product name.

For each row, build "reason", "justification" and "representation" around these four points, in this order:
1. Where the requirement appears in the tender document — cite it as "Page X, Point/Clause Y" using any page markers in the bid document text above to find the exact page, and quote or closely paraphrase the exact wording of the clause. If the bid document text isn't provided above or the clause can't be located in it, skip the citation rather than inventing a page number.
2. What is wrong with that requirement as written — based on the complete product specification and market context, explain why it is overly restrictive, non-standard, or unfairly narrows competition to a single make/model.
3. What we offer instead — the specific capability of "${resolvedProductName}" that addresses the underlying need.
4. The concrete advantage the customer/tender-issuing authority gains by accepting this — be specific (performance, compliance, cost, functional equivalence or superiority), not generic.

Split that four-point narrative across the three fields like this:
- "reason": points 1 and 2 — the clause citation and what's wrong with it.
- "justification": points 3 and 4 — what we offer and the advantage to the customer.
- "representation": all four points woven into one polished, professional paragraph for the letter body (connected prose, not a bullet list).

Return ONLY a valid JSON array with objects containing these exact keys: specification, tender_requirement, product_offered, reason, justification, representation. Do not include any markdown formatting or code blocks, just the raw JSON array.`;
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt };
