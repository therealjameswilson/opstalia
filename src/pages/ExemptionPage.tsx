import { useMemo, useState } from "react";
import { exemptionCodes, exemptionDictionaryVersion, exemptionInterpretationWarning } from "../data/registry";
import { ExternalLink, SectionHeading } from "../ui/common";

export function ExemptionPage() {
  const [query, setQuery] = useState("");
  const [system, setSystem] = useState("all");
  const systems = [...new Set(exemptionCodes.map((code) => code.system))].sort();
  const visible = useMemo(
    () =>
      exemptionCodes.filter(
        (code) =>
          (system === "all" || code.system === system) &&
          `${code.code} ${code.aliases.join(" ")} ${code.shortDefinition} ${code.detailedDefinition}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase())
      ),
    [query, system]
  );
  return (
    <>
      <SectionHeading eyebrow={`Versioned dictionary ${exemptionDictionaryVersion}`} title="Exemption and release-marking guide">
        <p>Authoritative definitions and cautious interpretation for visible markings on official public copies.</p>
      </SectionHeading>
      <div className="notice notice-caution">
        <strong>Interpret with the source in hand.</strong>
        <p>{exemptionInterpretationWarning}</p>
      </div>
      <div className="toolbar exemption-toolbar">
        <label>
          <span>Search codes or definitions</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="b7E, P1, sanitized…" />
        </label>
        <label>
          <span>System</span>
          <select value={system} onChange={(event) => setSystem(event.target.value)}>
            <option value="all">All systems</option>
            {systems.map((entry) => <option key={entry}>{entry}</option>)}
          </select>
        </label>
      </div>
      <div className="code-grid">
        {visible.map((code) => (
          <article className="code-card" key={`${code.system}-${code.code}`}>
            <header>
              <span className="code-token" title={code.shortDefinition}>{code.code}</span>
              <span>{code.system}</span>
            </header>
            <h2>{code.shortDefinition}</h2>
            <p>{code.detailedDefinition}</p>
            <dl>
              <div><dt>Authority</dt><dd>{code.authority}</dd></div>
              <div><dt>Aliases</dt><dd>{code.aliases.join(", ") || "None"}</dd></div>
              <div><dt>Agency variation</dt><dd>{code.interpretationVariesByAgency ? "Yes — preserve the source legend" : "Not normally"}</dd></div>
              <div><dt>Last verified</dt><dd>{code.lastVerified}</dd></div>
            </dl>
            {code.notes && <p className="code-note">{code.notes}</p>}
            <ExternalLink href={code.officialCitationUrl}>Official authority</ExternalLink>
          </article>
        ))}
      </div>
    </>
  );
}
