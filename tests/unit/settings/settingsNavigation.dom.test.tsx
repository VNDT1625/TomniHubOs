/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SettingsGlassDropdown from "@/renderer/components/layout/Titlebar/SettingsGlassDropdown";
import SettingsSider from "@/renderer/pages/settings/components/SettingsSider";

const navigate = vi.fn();
let pathname = "/settings/model";

vi.mock("@arco-design/web-react", () => ({
  Popover: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <>{children}{content}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key, i18n: { language: "vi-VN" } }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname }),
  useNavigate: () => navigate,
}));

vi.mock("@/renderer/hooks/context/LayoutContext", () => ({
  useLayoutContext: () => undefined,
}));

vi.mock("@/renderer/hooks/system/useExtensionSettingsTabs", () => ({
  useExtensionSettingsTabs: () => [],
}));

vi.mock("@/renderer/hooks/system/useExtI18n", () => ({
  useExtI18n: () => ({ resolveExtTabName: () => "Extension" }),
}));

vi.mock("@/renderer/hooks/context/AuthContext", () => ({
  useAuth: () => ({ user: { username: "Tomni User" }, logout: vi.fn() }),
}));

vi.mock("@/renderer/hooks/context/ThemeContext", () => ({
  useThemeContext: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("@/renderer/services/supabaseAuth", () => ({
  fetchTomProfile: vi.fn(),
  isSupabaseConfigured: () => false,
}));

vi.mock("@/renderer/services/i18n", () => ({
  changeLanguage: vi.fn(),
}));

vi.mock("@/renderer/utils/platform", () => ({
  isElectronDesktop: () => true,
  resolveExtensionAssetUrl: (value: string) => value,
}));

describe("settings navigation shortcuts", () => {
  beforeEach(() => {
    navigate.mockClear();
    pathname = "/settings/model";
  });

  afterEach(() => {
    cleanup();
  });

  it("provides a fixed Home action at the top of the Settings sidebar", () => {
    render(<SettingsSider />);

    const homeAction = screen.getByRole("button", { name: "Trang chủ" });
    fireEvent.click(homeAction);

    expect(navigate).toHaveBeenCalledWith("/guid");
  });

  it("shows a Home shortcut instead of Settings in the account menu while on Settings", () => {
    render(<SettingsGlassDropdown />);

    const homeAction = screen.getByRole("button", { name: "Trang chủ" });
    fireEvent.click(homeAction);

    expect(navigate).toHaveBeenCalledWith("/guid");
  });
});
