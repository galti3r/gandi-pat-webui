#!/usr/bin/env bash
# Build script: assembles src/ into dist/ with separate CSS, JS, and asset files
# Content hashing for cache busting: app.<hash>.css, app.<hash>.js, <lang>.<hash>.json

set -euo pipefail

TEMPLATE="src/index.html"
DIST="dist"

CSS_FILES=(
    src/css/variables.css
    src/css/layout.css
    src/css/components.css
    src/css/responsive.css
)

JS_FILES=(
    src/js/state.js
    src/js/helpers.js
    src/js/api.js
    src/js/ui.js
    src/js/i18n.js
    src/js/validation.js
    src/js/auth.js
    src/js/domains.js
    src/js/record-types.js
    src/js/records.js
    src/js/dnssec.js
    src/js/nameservers.js
    src/js/history.js
    src/js/app.js
)

# Compute 8-char sha256 hash of a file
hash8() {
    local h
    h=$(sha256sum "$1")
    echo "${h:0:8}"
}

# Clean and create dist structure
rm -rf "$DIST"
mkdir -p "$DIST/css" "$DIST/js" "$DIST/i18n" "$DIST/images"

# --- Step 1: Build CSS and JS, copy assets ---

# Concatenate CSS
{
    for f in "${CSS_FILES[@]}"; do
        if [[ -f "$f" ]]; then
            echo "/* --- $(basename "$f") --- */"
            cat "$f"
            echo ""
        fi
    done
} > "$DIST/css/app.css"

# Concatenate JS wrapped in IIFE
{
    echo "(function() {"
    echo '"use strict";'
    for f in "${JS_FILES[@]}"; do
        if [[ -f "$f" ]]; then
            echo ""
            echo "// --- $(basename "$f") ---"
            cat "$f"
        fi
    done
    echo ""
    echo "})();"
} > "$DIST/js/app.js"

# Copy i18n files
if [[ -d "src/i18n" ]]; then
    cp src/i18n/*.json "$DIST/i18n/" 2>/dev/null || true
fi

# Copy images and favicon
if [[ -d "src/images" ]]; then
    cp src/images/* "$DIST/images/" 2>/dev/null || true
fi
if [[ -f "src/favicon.svg" ]]; then
    cp src/favicon.svg "$DIST/"
fi
if [[ -f "src/manifest.json" ]]; then
    cp src/manifest.json "$DIST/"
fi

# Copy HTML template
cp "$TEMPLATE" "$DIST/index.html"

# --- Step 2: Hash i18n files ---

declare -A I18N_HASHED
for json_file in "$DIST"/i18n/*.json; do
    base=$(basename "$json_file" .json)
    h=$(hash8 "$json_file")
    hashed_name="${base}.${h}.json"
    mv "$json_file" "$DIST/i18n/$hashed_name"
    I18N_HASHED[$base]="$hashed_name"
done

# --- Step 3: Inject hashed i18n filenames into app.js ---

if [[ -z "${I18N_HASHED[en]:-}" ]] || [[ -z "${I18N_HASHED[fr]:-}" ]]; then
    echo "ERROR: Missing i18n files (en.json, fr.json)" >&2
    exit 1
fi

sed_expr="s|I18N_FILES = { en: 'en.json', fr: 'fr.json' }|I18N_FILES = { en: '${I18N_HASHED[en]}', fr: '${I18N_HASHED[fr]}' }|"
sed -i "$sed_expr" "$DIST/js/app.js"

# --- Step 4: Hash CSS ---

css_hash=$(hash8 "$DIST/css/app.css")
mv "$DIST/css/app.css" "$DIST/css/app.${css_hash}.css"

# --- Step 5: Hash JS (now contains correct i18n refs) ---

js_hash=$(hash8 "$DIST/js/app.js")
mv "$DIST/js/app.js" "$DIST/js/app.${js_hash}.js"

# --- Step 6: Rewrite references in index.html ---

sed -i \
    -e "s|css/app\.css|css/app.${css_hash}.css|g" \
    -e "s|js/app\.js|js/app.${js_hash}.js|g" \
    "$DIST/index.html"

echo "Built dist/ ($(du -sh "$DIST" | cut -f1) total)"
echo "  css/app.${css_hash}.css"
echo "  js/app.${js_hash}.js"
for lang in "${!I18N_HASHED[@]}"; do
    echo "  i18n/${I18N_HASHED[$lang]}"
done
