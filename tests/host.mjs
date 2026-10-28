// A fake Intapp host. It puts a `celeste` object on the page that answers the same tool calls the
// wizard makes (get_party, get_component_group, search_entities), from plain data.
// All names, ids and companies here are made up.

// ---- Corporate trees ---------------------------------------------------------------------------

// Root Co (R) > Alpha Inc (A) > Mid Co (X) > Target LLC (T), with Sub Two (S2) beside Mid Co and Bravo Ltd (B) beside Alpha.
export function standardTree() {
  return {
    externalId: "R", name: "Root Co", subCompanies: [
      { externalId: "A", name: "Alpha Inc", subCompanies: [
        { externalId: "X", name: "Mid Co", subCompanies: [{ externalId: "T", name: "Target LLC", subCompanies: [] }] },
        { externalId: "S2", name: "Sub Two", subCompanies: [] },
      ] },
      { externalId: "B", name: "Bravo Ltd", subCompanies: [] },
    ],
  };
}

// ---- Close-affiliate (significant influence) hierarchies ---------------------------------------
// Each is the shape the host sends: a list of roots, nested through `closeAffiliates`.

const ca = (id, name, kids = []) => ({ id, name, closeAffiliates: kids });

export const closeAffiliates = {
  // SI companies sit under the target
  underTarget: [ca("X", "Mid Co", [ca("T", "Target LLC", [ca("S1", "SI Holdings", [ca("S1a", "SI Child")]), ca("S3", "SI Plain")])])],
  // SI company is a sibling of the target
  sibling: [ca("A", "Alpha Inc", [ca("S1", "SI Holdings", [ca("S1a", "SI Child")]), ca("T", "Target LLC")])],
  // the affiliate data starts at a company that is not in the corporate tree at all
  outsideRoot: [ca("ZZ", "Outside Root", [ca("T", "Target LLC", [ca("S1", "SI Holdings")]), ca("S5", "SI Other")])],
  // the SI company is the parent of the target
  investor: [ca("S1", "SI Investor", [ca("T", "Target LLC"), ca("S9", "SI Sibling")])],
  // the target is the affiliate root
  targetRoot: [ca("T", "Target LLC", [ca("S1", "SI Holdings")])],
};

// ---- Engagement group members (matters) --------------------------------------------------------

export const matter = (id, clientId, name) => ({ type: "Matter", matterId: id, clientId, name });

// ---- Orbis notes -------------------------------------------------------------------------------

export const orbisRecord = {
  name: "Target LLC", status: "Active", countryIso: "AU", usState: null, legalForm: "Private limited companies", isin: null,
  listed: "Unlisted", exchange: null, nace: "7022", naceLabel: "Business and other management consultancy activities",
  naics2017: "5416", ussic: "874", industryClassification: "ANZ SIC 2006", bvd9: "165777821", orbisRecords: 1, orbisConflicts: [],
};

// The note editor pads every line with a non-breaking space; this is what a real note looks like.
export function orbisNoteHtml(key, record = orbisRecord) {
  const lines = (`"${key}": ` + JSON.stringify(record, null, 2)).split("\n");
  return lines.map((l) => `<div>${l.replace(/^ +/, (sp) => " " + sp.slice(1))}</div>`).join("");
}

// ---- The host ----------------------------------------------------------------------------------

/**
 * cfg:
 *   tree            corporate tree root (default standardTree)
 *   targetId        BvD / tree id of the target (default "T")
 *   partyId         Intapp party id of the target (default "P1")
 *   closeAffiliates list of affiliate roots (default none)
 *   members         engagement group members (default none)
 *   notes           how get_party ["Notes"] answers: { party } | { reject: "message" } | { raw: <value> }
 *                   default: a party with a readable Orbis note keyed by the target id
 * Returns the script to inject before the page loads. window.__calls records every call made.
 */
export function hostScript(cfg = {}) {
  const c = {
    tree: standardTree(), targetId: "T", partyId: "P1", closeAffiliates: [], members: [], ...cfg,
  };
  const family = {
    partyId: c.partyId, bureauVanDijkId: c.targetId, name: "Target LLC",
    corporateTrees: [{ providerType: "BureauVanDijk", rootCompanyId: c.tree.externalId, rootCompany: c.tree }],
    closeAffiliates: { closeAffiliates: c.closeAffiliates },
  };
  const notesAnswer = c.notes || {
    party: { partyId: c.partyId, bureauVanDijkId: c.targetId, name: "Target LLC",
             notes: [{ modifiedOn: "2026-01-01T00:00:00", message: orbisNoteHtml(c.targetId) }] },
  };
  return `(function () {
    var family = ${JSON.stringify(family)}, members = ${JSON.stringify(c.members)}, notes = ${JSON.stringify(notesAnswer)};
    window.__calls = [];
    Object.defineProperty(window, "celeste", { configurable: true, value: { query: function (name, args) {
      // the host knows capabilities by their full name; a short name is an error, as it is on the real host
      if (name.indexOf("intapp_compliance__") !== 0) return Promise.reject(new Error("unknown capability " + name));
      window.__calls.push([name.replace("intapp_compliance__", ""), args]);
      if (/get_party$/.test(name)) {
        var props = (args && args.propertiesToLoad) || [];
        if (props.indexOf("Notes") >= 0) {
          if (notes.reject) return Promise.reject(new Error(notes.reject));
          if (notes.raw !== undefined) return Promise.resolve(notes.raw);
          // the host answers with content blocks; the party is the first block's text
          return Promise.resolve([{ type: "text", text: notes.party, id: "lc_1" }, { type: "text", text: "Structured result: ..." }]);
        }
        return Promise.resolve(family);
      }
      if (/get_component_group$/.test(name)) return Promise.resolve({ groupMembers: members });
      return Promise.resolve({});
    } } });
  })();`;
}
