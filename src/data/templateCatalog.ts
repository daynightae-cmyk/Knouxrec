/**
 * The generated template families.
 *
 * `components/TemplatesPanel.tsx` builds 51 additional entries on top of the
 * five base templates with `generateDummyTemplate()`. Those entries carry a
 * random colour, a random aspect ratio and a preview thumbnail that points at
 * the external placeholder service `placehold.co`. They have no template
 * content, so the app lists them honestly instead of offering a button that
 * cannot work.
 *
 * The counts and base names are taken from the preserved panel:
 *   for-you 15, birthday 8, festival 6, vlog 10, social-media 12.
 */

export interface MockTemplateFamily {
  id: string;
  name: string;
  count: number;
}

export const MOCK_TEMPLATE_FAMILIES: MockTemplateFamily[] = [
  { id: "for-you", name: "قالب مقترح", count: 15 },
  { id: "birthday", name: "قالب عيد ميلاد", count: 8 },
  { id: "festival", name: "قالب مهرجان", count: 6 },
  { id: "vlog", name: "قالب فلوج", count: 10 },
  { id: "social-media", name: "قالب سوشيال ميديا", count: 12 },
];

export const MOCK_TEMPLATE_TOTAL = MOCK_TEMPLATE_FAMILIES.reduce(
  (total, family) => total + family.count,
  0,
);
