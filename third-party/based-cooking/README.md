# Based Cooking snapshot

Source: https://github.com/LukeSmithxyz/based.cooking

Pinned commit: a3eca801de59267d54e982a7f7a0e8e043a5532e

Upstream commit date: 2026-10-19T19:58:52-04:00

440 recipes from content/*.md, excluding the website index. All recipe text and author records are retained; image files are not copied. Original Markdown, source paths and hashes remain in the catalog. Recipe author names and source links remain attached to imported recipes. The original author registry is in authors.json, including the public credit links authors supplied.

LICENSE.md is copied verbatim. Upstream declares the website and all content public domain under the Unlicense: https://github.com/LukeSmithxyz/based.cooking#license

Course classifications are local heuristics, not official source labels. The complete catalog includes every course. Optional image links point to based.cooking/pix; the recipe text is fully local. Source time labels and serving ranges are retained without guessing missing values. Numeric totalMinutes is supplied only for a declared total or when both prep and cook times are present and every declared timing component parses exactly. Summed component times are derived locally; the original labels always remain available.

Rebuild the pinned snapshot, with no recipe API:

    node scripts/sync-based-cooking.cjs

Rebuild from an existing checkout:

    node scripts/sync-based-cooking.cjs --source /path/to/based.cooking

Refresh deliberately to an upstream ref:

    node scripts/sync-based-cooking.cjs --ref master

The default ref is pinned in the script. Output ordering and provenance are deterministic for the same upstream commit.
