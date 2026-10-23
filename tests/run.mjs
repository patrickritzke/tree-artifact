// Runs the wizard in a real browser against a fake host, once for the source page and once for the
// built min page. Run with: npm test   (needs `npx playwright install chromium`, or CHROMIUM_PATH).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { closeAffiliates, hostScript, matter, orbisNoteHtml, standardTree } from "./host.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["independence-wizard.html", "independence-wizard.min.html"];

// ---- harness -----------------------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let browser;
const open = async (file, cfg = {}, { service = "", steps = 2 } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.addInitScript(hostScript(cfg));
  await page.goto(pathToFileURL(path.join(ROOT, file)).href);
  await page.evaluate((svc) => {
    document.getElementById("start-id").value = "P1";
    document.getElementById("start-service").value = svc;
  }, service);
  for (let i = 0; i < steps; i++) {
    await page.click("#wiz-next");
    await page.waitForTimeout(350);
  }
  return page;
};
const rows = (page, grid = "tree-grid") =>
  page.$$eval(`#${grid} tbody tr`, (trs) => trs.map((t) => `${t.className} | ${t.innerText.replace(/\s+/g, " ").trim()}`));
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, " ").trim());
const noErrors = (page) => assert.deepEqual(page.errors, [], "page errors");
const openDisplay = (page) => page.click("#head-display");
const setView = async (page, mode, tree) => { // mode: "strictest" | "targetAll" | "all";  tree: "filtered" | "full" (optional)
  if (await page.$eval("#body-display", (e) => e.hidden)) await openDisplay(page);
  await page.click(`#inherit-view [data-v=${mode}]`);
  if (tree) await page.click(`#tree-view [data-v=${tree}]`);
  await page.waitForTimeout(150);
};

// Audit relationships used by several scenarios: Alpha under SEC, Root under AICPA, and a tax matter on the target.
const SEC_AICPA = [matter("m1", "A", "Audit FY25 [Audit - SEC]"), matter("m2", "R", "Audit FY25 [Audit - AICPA]")];

// ---- rule inheritance: what each row says -------------------------------------------------------

test("default view is filtered tree with the strictest result only", async (f) => {
  const p = await open(f, { members: SEC_AICPA });
  assert.deepEqual(await rows(p), [
    " | AICPA ▾ Root Co (R)",
    "sum-row | Filtered: 1 subsidiary",
    "restricted | SEC ▾ Alpha Inc (A) Inherited from",
    "sum-row | Filtered: 1 subsidiary",
    " | ▾ Mid Co (X)",
    "restricted | Target LLC (T) SEC - Restricted",
  ]);
  assert.equal(await text(p, "#display-summary"), "Filtered tree · Target only / Strictest rule");
  assert.equal(await p.$eval("#body-display", (e) => e.hidden), true, "Display Options starts collapsed");
  assert.equal(await text(p, "#tree-grid th.icon-col:not(.rule-col)"), "Audit Rule Treatment");
  noErrors(p);
});

test("target only / all rules: Other pill on the target, grey Inherited from on the other sources", async (f) => {
  const p = await open(f, { members: SEC_AICPA });
  await setView(p, "targetAll");
  const r = await rows(p);
  assert.match(r.find((x) => x.includes("Target LLC")), /SEC - Restricted ?Other \(1\)/);
  assert.match(r.find((x) => x.includes("Alpha Inc")), /^restricted \| .*Inherited from/, "the strictest source keeps its coloured pill");
  assert.ok(!/^(restricted|materiality)/.test(r.find((x) => x.includes("Root Co"))), "other sources are not shaded");
  const grey = await p.$$eval("#tree-grid .rule-badge.other", (b) => b.map((x) => x.textContent));
  assert.deepEqual(grey.sort(), ["Inherited from", "Other (1)"], "one grey Inherited from, one Other");
  assert.match(await text(p, "#display-summary"), /Target only \/ All rules/);
  await p.click("#tree-grid .rule-badge.other:has-text('Other')");
  assert.match(await text(p, "#why-pop"), /Other results.*Materiality check by AICPA/);
  await p.click("body");
  await p.click("#tree-grid .rule-badge.other:has-text('Inherited from')");
  assert.match(await text(p, "#why-pop"), /Materiality check by AICPA.*from Root Co/);
  noErrors(p);
});

test("all entities / all rules shows every entity's own result, on the filtered tree too", async (f) => {
  const p = await open(f, { members: SEC_AICPA });
  await setView(p, "all");
  const r = await rows(p);
  assert.ok(r.some((x) => /Filtered: /.test(x)), "the tree is still filtered");
  assert.match(r.find((x) => x.includes("Target LLC")), /Other \(1\)/);
  assert.match(r.find((x) => x.includes("Root Co")), /(Materiality check|Restricted)/, "Root Co shows its own result");
  assert.match(await text(p, "#display-summary"), /Filtered tree · All entities \/ All rules/);
  noErrors(p);
});

test("the tree choice is independent: full tree lists every entity, whichever view is chosen", async (f) => {
  const p = await open(f, { members: SEC_AICPA });
  for (const view of ["strictest", "targetAll", "all"]) {
    await setView(p, view, "full");
    const r = await rows(p);
    assert.equal(r.length, 6, `${view}: every entity is listed`);
    assert.ok(!r.some((x) => /Filtered: /.test(x)), `${view}: no filtered lines`);
    assert.ok(r.some((x) => x.includes("Sub Two")) && r.some((x) => x.includes("Bravo Ltd")));
  }
  await setView(p, "strictest", "full");
  const marked = (await rows(p)).filter((x) => /Inherited from|SEC - Restricted/.test(x));
  assert.equal(marked.length, 2, "strictest still marks only the target and its source");
  assert.match(await text(p, "#display-summary"), /Full tree · Target only \/ Strictest rule/);
  await setView(p, "strictest", "filtered");
  assert.ok((await rows(p)).some((x) => /Filtered: /.test(x)), "back to hidden subsidiaries");
  noErrors(p);
});

test("equal results: the audit relationship highest up the tree is the one inherited from", async (f) => {
  const both = [matter("m1", "A", "Audit [Audit - EU-537]"), matter("m2", "R", "Audit [Audit - EU-537]")];
  const p = await open(f, { members: both });
  const r = await rows(p);
  assert.match(r[0], /Root Co \(R\) Inherited from/);
  assert.ok(!r.some((x) => /Alpha Inc.*Inherited from/.test(x)), "the lower client is not marked");
  await setView(p, "targetAll");
  const all = await rows(p);
  assert.match(all.find((x) => x.includes("Target LLC")), /Other \(1\)/, "the lower client sits behind Other");
  assert.match(all.find((x) => x.includes("Root Co")), /Inherited from/);
  noErrors(p);
});

test("an exempt service line keeps the treatment and adds an Exempt Service Line pill", async (f) => {
  const p = await open(f, { members: [matter("m1", "A", "Audit [Audit - SEC]"), matter("m2", "R", "Audit [Audit - SEC]")] }, { service: "TAX-110" });
  const target = (await rows(p)).find((x) => x.includes("Target LLC"));
  assert.match(target, /^restricted \| .*SEC - Restricted ?Exempt Service Line/, "row is still shaded by the treatment");
  await p.click("#wiz-next");
  await p.waitForTimeout(500);
  const banners = await p.$$eval("#result-body .verdict", (v) => v.map((x) => ({ cls: x.className, txt: x.innerText.replace(/\s+/g, " ") })));
  assert.equal(banners.length, 1);
  assert.match(banners[0].cls, /exempt/, "assessment stays green");
  assert.equal((banners[0].txt.match(/by SEC/g) || []).length, 1, "one strictest result only");
  assert.match(banners[0].txt, /Restricted Exempt Service Line by SEC/);
  noErrors(p);
});

test("unchecking or adding an audit relationship changes the filter", async (f) => {
  const p = await open(f, { members: SEC_AICPA });
  const alpha = '#audit-rows .audit-row:has(.dd-name:has-text("Alpha")) input[type=checkbox]';
  await p.click(alpha); // Alpha (SEC) off
  await p.waitForTimeout(150);
  const off = await rows(p);
  assert.ok(!off.some((x) => /SEC ▾ Alpha/.test(x)), "Alpha loses its shield");
  assert.ok(off.some((x) => x.includes("Alpha Inc")), "but stays as a parent of the target");
  await p.click(alpha);
  await p.click("#add-audit");
  await p.click("#audit-rows .audit-row:last-child .dd-btn");
  await p.click('#audit-rows .audit-row:last-child .dd-opt:has-text("Bravo")');
  await p.waitForTimeout(200);
  assert.ok((await rows(p)).some((x) => x.includes("Bravo Ltd")), "an added client appears even before it has a rule");
  noErrors(p);
});

test("a row whose only child is a filtered line starts collapsed", async (f) => {
  const tree = standardTree();
  tree.subCompanies[1].subCompanies = [{ externalId: "B1", name: "Bravo Child", subCompanies: [] }]; // Bravo gets a child nobody cares about
  const p = await open(f, { tree, members: [...SEC_AICPA, matter("m3", "B", "Audit [Audit - SEC]")] });
  const r = await rows(p);
  const at = r.findIndex((x) => x.includes("Bravo Ltd"));
  assert.ok(at >= 0, "Bravo is shown as an audit relationship");
  assert.match(r[at], /▸/, "closed");
  assert.ok(!r[at + 1] || !/Filtered:/.test(r[at + 1]), "its filtered line is folded away");
  noErrors(p);
});

// ---- the assessment ------------------------------------------------------------------------------

const nodeTexts = (p) => p.$$eval("#result-body .cnode", (n) => n.map((x) => x.innerText.replace(/\s+/g, " ")));

test("the animation shows the structure up to the ultimate owner, with the rule only where it is inherited", async (f) => {
  // Ultimate Co > Parent Co (audit) > Mid Co > Target; Side Co hangs beside Mid Co; Other Parent is a close-affiliate parent that also holds an audit relationship.
  const tree = { externalId: "U", name: "Ultimate Co", subCompanies: [
    { externalId: "C", name: "Parent Co", subCompanies: [
      { externalId: "SG", name: "Mid Co", subCompanies: [{ externalId: "T", name: "Target LLC", subCompanies: [] }] },
      { externalId: "O", name: "Side Co", subCompanies: [] },
    ] },
  ] };
  const aff = [{ id: "C", name: "Parent Co", closeAffiliates: [
    { id: "SG", name: "Mid Co", closeAffiliates: [{ id: "T", name: "Target LLC", closeAffiliates: [] }] },
    { id: "PS", name: "Other Parent", closeAffiliates: [{ id: "T", name: "Target LLC", closeAffiliates: [] }] },
  ] }];
  const members = [matter("m1", "C", "Audit [Audit - IESBA-PIE]"), matter("m2", "PS", "Audit [Audit - IESBA-PIE]")];
  const p = await open(f, { tree, closeAffiliates: aff, members });
  await p.click("#wiz-next");
  await p.waitForTimeout(9000); // let the animation finish
  assert.match(await text(p, "#result-body .verdict"), /Restricted/);
  const all = await nodeTexts(p);
  const by = (name) => all.find((x) => x.includes(name));
  assert.equal(all.length, 4, `entities: ${all.join(" | ")}`);
  assert.ok(by("Ultimate Co"), "shown up to the ultimate owner");
  assert.ok(!all.join().match(/Other Parent|Side Co/), "nothing beside the path");
  assert.ok(!/IESBA/.test(by("Ultimate Co").replace("IESBA (PIE) - ", "")) && !/- Restricted/.test(by("Ultimate Co")), "no rule on an entity outside the inheritance");
  assert.match(by("Parent Co"), /IESBA \(PIE\)/, "the source carries its rule");
  assert.match(by("Mid Co"), /IESBA \(PIE\) - Restricted/, "an entity on the inheritance path carries the result");
  assert.match(by("Target LLC"), /IESBA \(PIE\) - Restricted/);
  const dots = await p.$$eval("#result-body .cdot", (d) => d.map((x) => parseFloat(x.style.opacity || 0)));
  assert.ok(dots.length > 5 && dots.every((o) => o > 0), "the inheritance is a dotted line over the structure lines, fully drawn");
  assert.equal(await p.$$eval("#result-body .chl", (d) => d.length), 0, "no solid inheritance line");
  assert.equal(await p.$$eval("#result-body .clabel", (d) => d.length), 0, "no across label for a parent and child");
  noErrors(p);
});

test("a sibling's inheritance goes straight across as a dotted line, with the structure drawn first", async (f) => {
  // Root > Parent > (Target, Sibling Co); the audit relationship is the sibling.
  const tree = { externalId: "U", name: "Ultimate Co", subCompanies: [
    { externalId: "A", name: "Parent Co", subCompanies: [
      { externalId: "T", name: "Target LLC", subCompanies: [] },
      { externalId: "S", name: "Sibling Co", subCompanies: [] },
      { externalId: "Z", name: "Unrelated Co", subCompanies: [] },
    ] },
  ] };
  const p = await open(f, { tree, members: [matter("m1", "S", "Audit [Audit - IESBA-PIE]")] });
  await p.click("#wiz-next");
  await p.waitForTimeout(500);
  // early in the animation the structure is there but nothing is inherited yet
  assert.equal(await p.$$eval("#result-body .cdot", (d) => d.filter((x) => parseFloat(x.style.opacity || 0) > 0).length), 0, "no dots before the structure is built");
  await p.waitForTimeout(9000);
  const all = await nodeTexts(p);
  assert.equal(all.length, 4, `entities: ${all.join(" | ")}`);
  assert.ok(!all.join().includes("Unrelated Co"), "an unrelated sibling is not drawn");
  assert.match(all.find((x) => x.includes("Target LLC")), /Materiality check/);
  assert.match(all.find((x) => x.includes("Sibling Co")), /IESBA \(PIE\)/, "the source carries its rule");
  assert.ok(!/- (Restricted|Materiality)/.test(all.find((x) => x.includes("Parent Co")) + all.find((x) => x.includes("Ultimate Co"))), "no rule on the parents");
  const dots = await p.$$eval("#result-body .cdot", (d) => d.map((x) => parseFloat(x.style.opacity || 0)));
  assert.ok(dots.length > 5 && dots.every((o) => o > 0), "the dotted line is fully drawn");
  assert.equal(await text(p, "#result-body .clabel"), "Sibling", "the line says what the relationship is");
  noErrors(p);
});

// ---- significant influence -----------------------------------------------------------------------

for (const [shape, affiliates] of Object.entries(closeAffiliates)) {
  test(`SI grid shows the target and SI-only companies (${shape}); the tree grid shows no SI company`, async (f) => {
    const p = await open(f, { members: SEC_AICPA, closeAffiliates: affiliates });
    assert.equal(await p.$eval("#si-section", (e) => !e.hidden), true, "SI grid is shown");
    assert.equal(await text(p, "#si-section h2"), "Significant Influence (20-50%)");
    assert.equal(await text(p, ".section-head h2"), "Corporate Tree (50%)");
    const si = (await rows(p, "si-grid")).join("\n");
    assert.match(si, /Target LLC \(T\)/, "the target is on the SI grid");
    assert.match(si, /SI /, "an SI company is on the SI grid");
    const tree = (await rows(p)).join("\n");
    assert.ok(!/ SI /.test(tree), "no SI company in the corporate tree grid");
    assert.ok(!/ held by /i.test(si + tree), "no held-by notes");
    noErrors(p);
  });
}

test("SI grid shows the full chain of parents above the target", async (f) => {
  const p = await open(f, { closeAffiliates: closeAffiliates.underTarget });
  const si = await rows(p, "si-grid");
  const names = si.map((x) => x.replace(/^.*?\| (?:\S+ )*?(?=\S*[A-Z])/, ""));
  assert.match(si[0], /Root Co/);
  assert.match(si.join("|"), /Root Co.*Alpha Inc.*Mid Co.*Target LLC.*SI Holdings.*SI Child.*SI Plain/);
  assert.ok(names.length >= 7);
  noErrors(p);
});

test("a SigInf relationship is not listed when its tree equivalent already is", async (f) => {
  const p = await open(f);
  const r = await p.evaluate(() => [
    showRels(["Sibling", "SigInf - Sibling"]),
    showRels(["Sibling", "SigInf - Immediate Parent"]),
    showRels(["SigInf - Cousin"]),
  ]);
  assert.deepEqual(r, [["Sibling"], ["Sibling", "SigInf - Immediate Parent"], ["SigInf - Cousin"]]);
  noErrors(p);
});

// ---- the Find step -------------------------------------------------------------------------------

test("firmographics come from the party note, including notes padded with non-breaking spaces", async (f) => {
  const p = await open(f, {}, { steps: 1 });
  const facts = await p.$$eval("#find-facts > div", (d) => d.map((x) => x.innerText.replace(/\s+/g, " ")));
  assert.deepEqual(facts, ["COUNTRY Australia", "LISTINGS Not listed", "INDUSTRY Management consultancy"]);
  noErrors(p);
});

test("firmographics are looked up with the Intapp party id only", async (f) => {
  const p = await open(f, {}, { steps: 1 });
  const ids = (await p.evaluate(() => window.__calls)).filter(([n, a]) => n === "get_party" && a.propertiesToLoad.includes("Notes")).map(([, a]) => a.partyId);
  assert.deepEqual(ids, ["P1"], "never the tree or provider id");
  noErrors(p);
});

for (const [name, notes, expected] of [
  ["a rejected lookup", { reject: "forbidden" }, /party lookup for P1 failed \(forbidden\)/],
  ["a reply with no partyId", { raw: [{ type: "text", text: { name: "x" } }] }, /had no partyId/],
  ["a party with no notes", { party: { partyId: "P1", bureauVanDijkId: "T", notes: [] } }, /the party has no notes/],
  ["a note under a different key", { party: { partyId: "P1", bureauVanDijkId: "T", notes: [{ modifiedOn: "1", message: orbisNoteHtml("OTHER") }] } }, /no note holds a record under T \(found: OTHER\)/],
]) {
  test(`when firmographics are missing, the page says why: ${name}`, async (f) => {
    const p = await open(f, { notes }, { steps: 1 });
    assert.match(await text(p, "#find-facts"), /Not available/);
    assert.match(await text(p, "#find-foot"), expected);
    noErrors(p);
  });
}

test("no engagements found: the page says none and lets you continue", async (f) => {
  const p = await open(f, { members: [] });
  assert.equal(await p.$eval("#page-tree", (e) => e.classList.contains("active")), true, "reached the rule inheritance step");
  assert.match(await text(p, "#find-foot"), /No engagements were found/);
  noErrors(p);
});

test("the Find step fits a 1280x720 window without scrolling", async (f) => {
  const p = await open(f, { members: [...SEC_AICPA, matter("m3", "B", "Tax advisory")] }, { steps: 1 });
  assert.ok(await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight), "no page scroll");
  noErrors(p);
});

// ---- wording -------------------------------------------------------------------------------------

test("wording: audit relationship, SigInf, filtered", async (f) => {
  const p = await open(f, { members: SEC_AICPA, closeAffiliates: closeAffiliates.underTarget });
  const page = (await p.evaluate(() => document.body.innerText)).toLowerCase();
  assert.ok(!page.includes("audit client"), "no 'audit client' left on screen");
  assert.ok(!page.includes("ca - "), "no 'CA - ' left on screen");
  assert.match(await text(p, ".eng-key"), /Audit relationship.*Non-audit relationship/);
  assert.ok((await rows(p)).some((r) => /Filtered: \d+ subsidiar/.test(r)));
  noErrors(p);
});

// ---- run -----------------------------------------------------------------------------------------

const build = spawnSync(process.execPath, [path.join(ROOT, "build.mjs"), "--check"], { stdio: "inherit" });
let failed = build.status === 0 ? 0 : 1;

browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const file of FILES) {
  console.log(`\n${file}`);
  for (const t of tests) {
    try {
      await t.fn(file);
      console.log(`  ok    ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL  ${t.name}\n        ${String(e.message).split("\n").join("\n        ")}`);
    }
  }
}
await browser.close();
console.log(failed ? `\n${failed} failure(s)` : "\nall passed");
process.exit(failed ? 1 : 0);
