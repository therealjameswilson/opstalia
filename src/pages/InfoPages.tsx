import { SectionHeading, ExternalLink } from "../ui/common";

export function AboutPage() {
  return (
    <>
      <SectionHeading eyebrow="Independent records research" title="About Opstalia">
        <p>Opstalia helps a researcher ask whether a record described by unclassified metadata appears to have been officially released to the public.</p>
      </SectionHeading>
      <div className="prose-grid">
        <article className="prose">
          <h2>What it does</h2>
          <p>Opstalia builds deterministic search plans, searches supported official repositories, normalizes available metadata, ranks likely matches, groups possible versions, and generates a source-auditable report.</p>
          <h2>What it does not do</h2>
          <p>It does not accept classified or restricted material. It does not search leaks, unofficial mirrors, media caches, personal sites, commercial repositories, crowdsourced archives, social uploads, anonymous hosts, or unofficial document copies.</p>
          <p>It does not determine classification, declassification, legal disclosure obligations, authenticity, or completeness.</p>
          <h2>Relationship to NARA Scout</h2>
          <p>Opstalia was developed from concepts first implemented in NARA Scout. It is a separate federated application and repository; NARA Scout remains a specialized FRUS research-planning tool.</p>
        </article>
        <aside className="principles-card">
          <h2>Evidence order</h2>
          <ol>
            <li>Official source-reported fact</li>
            <li>Opstalia extraction or normalization</li>
            <li>Explainable Opstalia inference</li>
            <li>Researcher judgment with recorded basis</li>
            <li>Unknown when the evidence does not support more</li>
          </ol>
          <p className="fine-print">Official source records and agency determinations control.</p>
        </aside>
      </div>
    </>
  );
}

export function SecurityPage() {
  return (
    <>
      <SectionHeading eyebrow="Public-build boundary" title="Security model">
        <p>Opstalia 1.0 is purely unclassified and operates on the regular Internet. It is not an authorized system for classified records.</p>
      </SectionHeading>
      <div className="notice notice-danger">
        <strong>Use unclassified information only.</strong>
        <p>Do not enter, upload, paste, or transmit classified information, controlled unclassified information, personally identifiable information, or other restricted material.</p>
      </div>
      <section className="data-flow" aria-labelledby="flow-title">
        <h2 id="flow-title">Exactly what leaves the browser</h2>
        <div className="flow-diagram" role="img" aria-label="Browser sends a selected unclassified live-source query to the Opstalia Worker, which sends only needed parameters to the selected official NARA, GovInfo, NASA NTRS, or OSTI API. Local indexes are searched inside the browser. Manual sources open their official website only when the researcher chooses.">
          <div><strong>Your browser</strong><span>Unclassified search terms; local projects in IndexedDB</span></div>
          <span aria-hidden="true">→</span>
          <div><strong>Opstalia Worker</strong><span>Selected official-API query; no body logging or source-response cache</span></div>
          <span aria-hidden="true">→</span>
          <div><strong>Selected official API</strong><span>NARA · GovInfo · NASA NTRS · OSTI</span></div>
        </div>
        <div className="flow-diagram local-flow" role="img" aria-label="FRUS, ISCAP, and NDC indexes remain local in the browser.">
          <div><strong>Your browser</strong><span>FRUS · ISCAP · NDC local indexes</span></div>
          <span aria-hidden="true">↺</span>
          <div><strong>No runtime source request</strong><span>Indexes are pinned and refreshed during a controlled build</span></div>
        </div>
      </section>
      <div className="prose">
        <h2>Private search mode</h2>
        <p>Private mode disables Opstalia project persistence, browser search history, and reusable response state. Closing or reloading the tab clears the in-memory project. Queries still must be transmitted to the selected live official repository through the Worker. Private mode is not anonymity.</p>
        <h2>Secrets</h2>
        <p>The NARA and GovInfo keys exist only as Worker secrets named <code>NARA_API_KEY</code> and <code>GOVINFO_API_KEY</code>. NASA NTRS and OSTI do not require application secrets. Frontend variables beginning with <code>VITE_</code> are public and must never contain secrets.</p>
        <h2>Future Opstalia-c relationship</h2>
        <p>No synchronization, bridge, connector, export automation, or network route to Opstalia-c exists in 1.0. A future closed-network integration would be a separate security-reviewed system. Classification cannot be removed by OCR, transcription, paraphrase, summarization, or metadata extraction.</p>
      </div>
    </>
  );
}

export function PrivacyPage() {
  return (
    <>
      <SectionHeading eyebrow="Privacy-minimizing by default" title="Privacy">
        <p>No third-party analytics, advertising, remote fonts, or user accounts are included.</p>
      </SectionHeading>
      <div className="prose">
        <h2>Local data</h2>
        <p>Non-private search projects, saved locators, public non-NARA source responses, annotations, comparisons, and reports are stored in the browser's namespaced IndexedDB. GitHub Pages project sites share an origin; do not store secrets or restricted information in Opstalia.</p>
        <h2>NARA data-minimization rule</h2>
        <p>Current NARA API terms prohibit caching or storing API-returned content. Opstalia therefore keeps NARA responses in memory only. A saved NARA item is reduced to a generated NAID/official-URL locator plus researcher-created review data and is rehydrated only by a later live search.</p>
        <h2>Network data</h2>
        <p>The GitHub Pages host receives ordinary web requests for application files. Cloudflare receives a POST containing each selected unclassified live-source query. The Worker sends only the needed query and filters to the selected official NARA, GovInfo, NASA NTRS, or OSTI API. Manual adapters contact an official source only after the researcher opens the prepared handoff; that source then receives normal browser request information.</p>
        <h2>Logging</h2>
        <p>Application code does not log full queries, request bodies, API keys, authorization headers, or IP addresses. Cloudflare and GitHub may maintain infrastructure logs under their own policies.</p>
      </div>
      <ExternalLink href="https://github.com/therealjameswilson/opstalia/blob/main/PRIVACY.md">Read the repository privacy statement</ExternalLink>
    </>
  );
}
