import os
import re
import sys
import asyncio
from markdown_it import MarkdownIt

async def main():
    print("Reading README.md...")
    readme_path = "README.md"
    if not os.path.exists(readme_path):
        print(f"Error: {readme_path} not found.")
        sys.exit(1)
        
    with open(readme_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    print("Converting Markdown to HTML...")
    # Initialize markdown-it-py
    md = MarkdownIt()
    html_body = md.render(md_text)

    # Convert mermaid code block for mermaid.js representation
    # markdown-it-py renders ```mermaid as <pre><code class="language-mermaid">...</code></pre>
    # or sometimes <pre class="language-mermaid"><code>...</code></pre>
    # We want to transform it into <pre class="mermaid">...</pre>
    def replace_mermaid(match):
        code_content = match.group(1)
        # HTML unescape basic entities if any
        code_content = code_content.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
        return f'<pre class="mermaid">{code_content}</pre>'

    html_body = re.sub(
        r'<pre><code class="language-mermaid">([\s\S]*?)</code></pre>',
        replace_mermaid,
        html_body
    )

    # HTML template with CSS styling
    html_template = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>朝読み（asayomi） 利用者マニュアル</title>
    <!-- Google Fonts for Japanese -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
    <!-- Mermaid JS -->
    <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
    <script>
        mermaid.initialize({{
            startOnLoad: true,
            theme: 'default',
            securityLevel: 'loose'
        }});
    </script>
    <style>
        body {{
            font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #2D3748;
            line-height: 1.6;
            margin: 0;
            padding: 10mm;
            background-color: #ffffff;
        }}
        h1 {{
            font-size: 20pt;
            color: #1A365D;
            border-bottom: 3px solid #2B6CB0;
            padding-bottom: 6px;
            margin-top: 25px;
            margin-bottom: 15px;
            page-break-after: avoid;
        }}
        h1:first-of-type {{
            margin-top: 0;
        }}
        h2 {{
            font-size: 15pt;
            color: #2B6CB0;
            border-bottom: 1px solid #E2E8F0;
            padding-bottom: 4px;
            margin-top: 22px;
            margin-bottom: 12px;
            page-break-after: avoid;
        }}
        h3 {{
            font-size: 12pt;
            color: #2D3748;
            margin-top: 15px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }}
        p, li, td, th {{
            font-size: 10pt;
        }}
        p {{
            margin-top: 0;
            margin-bottom: 10px;
        }}
        ul, ol {{
            margin-top: 0;
            margin-bottom: 10px;
            padding-left: 20px;
        }}
        li {{
            margin-bottom: 4px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            margin-bottom: 15px;
            page-break-inside: avoid;
        }}
        th, td {{
            border: 1px solid #CBD5E0;
            padding: 8px 10px;
            text-align: left;
        }}
        th {{
            background-color: #F7FAFC;
            color: #4A5568;
            font-weight: bold;
        }}
        tr:nth-child(even) td {{
            background-color: #F8FAFC;
        }}
        pre {{
            background-color: #EDF2F7;
            padding: 10px;
            border-radius: 5px;
            overflow-x: auto;
            font-size: 9pt;
            margin-top: 10px;
            margin-bottom: 10px;
        }}
        .mermaid {{
            background: transparent;
            display: flex;
            justify-content: center;
            margin: 15px 0;
            page-break-inside: avoid;
        }}
        hr {{
            border: 0;
            border-top: 1px solid #E2E8F0;
            margin: 20px 0;
        }}
        @media print {{
            body {{
                padding: 0;
            }}
            .no-print {{
                display: none;
            }}
        }}
    </style>
</head>
<body>
    {html_body}
</body>
</html>
"""

    temp_html_path = os.path.abspath("temp_readme.html")
    pdf_path = os.path.abspath("README.PDF")

    print(f"Writing temporary HTML to {temp_html_path}...")
    with open(temp_html_path, "w", encoding="utf-8") as f:
        f.write(html_template)

    print("Launching Playwright to generate PDF...")
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        # Launch chromium browser
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Load the local HTML file
        print(f"Loading page: file:///{temp_html_path}")
        await page.goto(f"file:///{temp_html_path}")
        
        # Wait for mermaid to render (usually fast, but let's wait a moment)
        print("Waiting for assets to load and Mermaid to render...")
        try:
            # If mermaid selector is present, wait for svg inside it
            await page.wait_for_selector(".mermaid svg", timeout=5000)
            print("Mermaid diagram detected and rendered successfully.")
        except Exception as e:
            print("No mermaid diagram detected or rendering timeout. Proceeding...")
            # Fallback sleep to ensure any other resources render
            await asyncio.sleep(2)

        # Generate PDF
        print(f"Saving PDF to {pdf_path}...")
        await page.pdf(
            path=pdf_path,
            format="A4",
            print_background=True,
            margin={
                "top": "15mm",
                "bottom": "15mm",
                "left": "15mm",
                "right": "15mm"
            },
            display_header_footer=True,
            header_template="<div></div>",
            footer_template='<div style="font-size: 8px; font-family: sans-serif; width: 100%; text-align: center; color: #718096;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        )
        
        await browser.close()
        
    # Clean up temporary HTML file
    if os.path.exists(temp_html_path):
        os.remove(temp_html_path)
        print("Temporary HTML file cleaned up.")
        
    print("PDF generation complete successfully!")

if __name__ == "__main__":
    asyncio.run(main())
