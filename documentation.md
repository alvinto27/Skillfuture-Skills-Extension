# Documentation

## What Was Changed

The Chrome extension now has clearer job-text extraction logic.

Before this change, the extension used one long list of selectors to search for job descriptions. That made debugging hard because we could not easily tell whether the extension was using a MyCareersFuture selector, a LinkedIn selector, or a generic fallback selector.

Now the selectors are grouped by website inside:

```text
Skillfuture-Skills-Extension/chrome_extension/contentScript.js
```

The groups are:

```text
myCareersFuture
linkedIn
generic
```

This makes it easier to see which extraction path was used.

## Why This Was Needed

MyCareersFuture pages have extra text that is not part of the employer's job requirements.

For example, MyCareersFuture may show text like:

```text
Tell employers what skills you have
The more skills you have, the better your job match
Your job match
Add skills
Skills you have
```

That text is for the user's profile, not the job posting.

The extension should not send that text to the backend for analysis.

## How MyCareersFuture Extraction Works

When the user clicks Analyze on a MyCareersFuture job page, the extension does this:

1. It checks whether the current page is a MyCareersFuture job page.
2. It looks for job section headings such as:

```text
Key Responsibilities
Responsibilities
Requirements
Requirements & Qualifications
Qualifications
Job Description
What you will be working on
What we are looking for
About the role
Skills required
```

3. If it finds one of those headings, it collects the text below the heading.
4. It stops collecting when it reaches the next major heading.
5. It removes repeated lines, empty lines, navigation text, footer text, and profile-suggestion text.
6. If headings are not found, it uses a safer fallback:

```text
cleaned main job content
```

The fallback cuts off the text before the profile-suggestion area, so it does not analyze text like `Tell employers what skills you have`.

## How Other Sites Work

For LinkedIn, the extension uses LinkedIn-specific selectors first.

For unknown or test pages, it uses the generic selector group.

If no selector works, it may use the body text as a last fallback.

## Selected Text Fallback

Normal scraping is still the first choice.

If the extension cannot find the job description automatically, it tells the user what to do:

```text
Could not find the job description automatically.

You can highlight the job description text on the page, then click Analyze again.
```

This means the user can manually select the job description text with their mouse, then click Analyze again.

On MyCareersFuture, selected text is used only after automatic scraping fails. This prevents selected text from replacing normal scraping when the page can already be read correctly.

When highlighted text is used, the results panel shows this message:

```text
Using selected text
The analysis is based on the text you highlighted on the page.
```

This is important because it tells the user that the extension did not scrape the page normally. It used the text they selected instead.

## Loading Skeleton

After the extension finds job text, it opens the side panel while the backend analysis is running.

The side panel does not show the extracted job text.

Instead, it shows a skeleton loading screen. The skeleton is shaped like the final results:

```text
summary card
result card with extracted skill column
arrow column
official match column
definition area
matched-because area
other possible matches row
```

This makes the loading screen feel closer to the final layout.

Expected behavior:

```text
User clicks Analyze
Extension finds job text
Side panel shows result-shaped skeleton loading placeholders
Backend analysis runs
Final skill matches replace the skeleton screen
```

## Analysis History

The extension now saves successful analyses into browser storage.

It saves the latest 10 analyzed jobs.

Each saved history item includes:

```text
job title
company name, if found
job page URL
analysis date and time
extracted skills
suitability score, if returned
saved result data
```

The History button appears in the side panel header, next to Hide.

When the user clicks History, the side panel shows saved analyses.

Each history item has:

```text
View result
Open job page
```

There is also a Clear history button.

When the user opens History, the Analyze button is shown again so the user is not stuck in the history screen.

If there is a current result, History shows:

```text
Back to result
```

If there is no current result, History shows:

```text
Close history
```

After the user clears history, the Analyze button stays available.

Expected behavior:

```text
User analyzes a job
Extension saves the result
User clicks History
Saved jobs appear in the side panel
User can view an old result without analyzing again
```

## Confidence Bubble Colors

The confidence bubble color now changes based on the match percentage:

```text
60% and above: green
40% to 59%: yellow
below 40%: red
```

Examples:

```text
High confidence - 64%  -> green
Medium confidence - 45% -> yellow
Low confidence - 29% -> red
```

## Debug Logs Added

Debug logs were added to help understand what the extension extracted.

The logs can show:

```text
Selector group selected
Selector used
Extracted character count
Fallback used
Selected text used
Final extracted job data
Ignored sections
Headings found
SPA navigation detected
```

This helps answer questions like:

```text
Did it use the MyCareersFuture extractor?
Which selector found the job text?
How much text was extracted?
Did it fall back to body text?
Did it use highlighted/selected text?
Was any section ignored?
Did the site change job pages without a full reload?
```

## SPA Navigation Support

SPA means Single Page Application.

Some job websites do not fully reload the page when the user opens another job. LinkedIn and MyCareersFuture can change the URL and job content using JavaScript while keeping the same page running.

Without SPA navigation support, the extension may keep old state from the previous job page.

For example:

```text
User analyzes Job A
User clicks Job B
The URL changes, but the browser tab does not fully reload
The extension may still show Job A's old analysis
```

The extension now watches for these page changes:

```text
history.pushState
history.replaceState
browser back/forward through popstate
interval backup check
```

When the extension detects that the URL changed, it does this:

1. Removes the old analysis panel.
2. Shows the Analyze button again.
3. Updates the stored current URL.
4. Writes a debug log called `SPA navigation detected`.

The debug log includes:

```text
reason
previousUrl
newUrl
analyzeButtonReset
```

Expected result:

```text
When the user moves from one job page to another without a full page reload, the extension resets itself and is ready to analyze the new job.
```

## How To Turn On Debug Logs

On local test pages, debug logs turn on automatically.

On a real MyCareersFuture or LinkedIn page, open Chrome DevTools Console and run:

```js
window.__skillsfuture_debug = true
```

Then click Analyze again.

Look for console messages that start with:

```text
[SkillsFuture]
```

## Files Changed

These files were changed for this work:

```text
Skillfuture-Skills-Extension/chrome_extension/contentScript.js
Skillfuture-Skills-Extension/chrome_extension/manifest.json
documentation.md
```

## Important Notes

The extension version was updated to:

```text
0.3.3
```

After changing extension files, reload the extension in:

```text
chrome://extensions
```

Then refresh the job page before testing again.
