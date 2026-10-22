import React from "react";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { CapabilityNotice, SectionHeader, StateBadge } from "../views/ui";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import { Icon } from "../app/icons";

const GROUP_KEYS: Record<string, string> = {
  capture: "groupRecord",
  library: "groupLibrary",
  create: "groupCreate",
  intelligence: "groupIntelligence",
  system: "groupSystem",
};

export default function ToolSection({
  route,
  children,
}: {
  route: RouteId;
  children: React.ReactNode;
}) {
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const capability = CAPABILITIES[route];
  const adult = route === "morphcore" || route === "body-editor";

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t(GROUP_KEYS[capability.group])}
        title={t(capability.labelKey)}
        description={capability.summary}
        actions={<StateBadge state={capability.state} />}
      />
      {adult && (
        <div className="kx-notice" data-tone="danger">
          <Icon name="lock" size={18} />
          <div>
            <strong>18+ section.</strong> Access requires the in-panel age gate. No
            content is generated without a working local engine.
          </div>
        </div>
      )}
      <CapabilityNotice capability={capability} />
      <div className="kx-embed">{children}</div>
    </div>
  );
}
