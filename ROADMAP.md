# pureknowledge contribution roadmap

Build something you can see and try in the app. The first five items are **good first contributions**: bounded changes with a concrete demonstration. Choose a feature below, fix a bug, or propose your own improvement.

## Scope

Keep the human-curated wiki and notes, existing spaces and page links, and recorded agent changes.

Size describes scope, not a promised completion time: **Small** = one focused interface change; **Medium** = coordinated interface/state work; **Large** = a feature across several flows, storage or export paths. All items are proposals, not claims that existing features are absent. Check the current code and extend what is there. Maintainers review code and tests before merging. Attribution is your choice.

## Good first contributions

1. **Copy a page’s path.** Add a copy control beside the current page path with feedback, making it easier to reference the page in other suite work.
   <!-- contribution: {"id": "page-path-copy-action", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/page-path-copy-action.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/page-path-copy-action.md)

2. **Recognise pages, notes and folders in search.** Label results as wiki pages, notes or directories using existing page kinds, rather than relying only on an icon.
   <!-- contribution: {"id": "search-result-type-labels", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/search-result-type-labels.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/search-result-type-labels.md)

3. **Clear a search with no results.** Offer a clear-query action and distinguish an empty space from a search with no matches.
   <!-- contribution: {"id": "search-empty-state-recovery", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/search-empty-state-recovery.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/search-empty-state-recovery.md)

4. **See exactly when a page changed.** Expose the exact last-edit date and time alongside any relative timestamp, with a consistent timezone presentation.
   <!-- contribution: {"id": "last-edit-timestamp-detail", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/last-edit-timestamp-detail.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/last-edit-timestamp-detail.md)

5. **Read a deeply nested page path.** Let deep page paths wrap or scroll without hiding the current page, and expose full names to keyboard users.
   <!-- contribution: {"id": "long-breadcrumb-handling", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/long-breadcrumb-handling.md"} -->
   [Small · Good first contribution · Implementation brief](docs/contributions/long-breadcrumb-handling.md)

## More improvements

6. **Read the matching passage in search results.** Show a short matched passage beside each page title in search results so users can distinguish pages covering similar subjects.
   <!-- contribution: {"id": "search-match-excerpts", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/search-match-excerpts.md"} -->
   [Medium · Implementation brief](docs/contributions/search-match-excerpts.md)

7. **Open an existing page instead of making a duplicate.** When page creation conflicts with an existing title, link to that page and retain the proposed text so it can be reused deliberately.
   <!-- contribution: {"id": "duplicate-title-guidance", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/duplicate-title-guidance.md"} -->
   [Medium · Implementation brief](docs/contributions/duplicate-title-guidance.md)

8. **Spot links to missing wiki pages.** Distinguish unresolved wiki links in rendered page text and show the target title without automatically creating a replacement page.
   <!-- contribution: {"id": "broken-wiki-link-styling", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/broken-wiki-link-styling.md"} -->
   [Medium · Implementation brief](docs/contributions/broken-wiki-link-styling.md)

9. **Add your first related resource.** Explain how to add the first resource link and include an example label and path appropriate to the current page.
   <!-- contribution: {"id": "related-link-empty-state", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/related-link-empty-state.md"} -->
   [Small · Implementation brief](docs/contributions/related-link-empty-state.md)

10. **Correct an invalid resource link.** Give field-level feedback for malformed resource URLs while continuing to support the existing local-path link format.
   <!-- contribution: {"id": "resource-url-validation", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/resource-url-validation.md"} -->
   [Medium · Implementation brief](docs/contributions/resource-url-validation.md)

11. **Tell resource links apart.** Use the saved descriptive label wherever available and expose the full destination on focus so similar links are distinguishable.
   <!-- contribution: {"id": "resource-link-labels", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/resource-link-labels.md"} -->
   [Small · Implementation brief](docs/contributions/resource-link-labels.md)

12. **Avoid duplicate tags.** Trim extra whitespace and avoid repeated identical tags while preserving the user's chosen wording.
   <!-- contribution: {"id": "tag-input-normalization", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/tag-input-normalization.md"} -->
   [Small · Implementation brief](docs/contributions/tag-input-normalization.md)

13. **Read long page titles.** Keep long page titles readable in the editor and navigation without shifting the save or page-action controls off screen.
   <!-- contribution: {"id": "long-title-layout", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/long-title-layout.md"} -->
   [Small · Implementation brief](docs/contributions/long-title-layout.md)

14. **Read the complete reason for an agent change.** Allow long agent-change summaries to wrap in the review area instead of hiding the reason for an edit.
   <!-- contribution: {"id": "agent-change-summary-wrapping", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/agent-change-summary-wrapping.md"} -->
   [Small · Implementation brief](docs/contributions/agent-change-summary-wrapping.md)

15. **Compare long before-and-after text.** Improve spacing and word wrapping in the existing review diff so long lines and URLs remain comparable within a narrow pane.
   <!-- contribution: {"id": "before-and-after-readability", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/before-and-after-readability.md"} -->
   [Medium · Implementation brief](docs/contributions/before-and-after-readability.md)

16. **Reset the change-review view.** Show active review sorting or filtering choices prominently and provide a simple reset to the default review list.
   <!-- contribution: {"id": "review-filter-reset", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/review-filter-reset.md"} -->
   [Medium · Implementation brief](docs/contributions/review-filter-reset.md)

17. **Check what deleting a page affects.** Name the page and its location in the existing delete confirmation and explain the current treatment of any child pages or links.
   <!-- contribution: {"id": "delete-page-context", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/delete-page-context.md"} -->
   [Medium · Implementation brief](docs/contributions/delete-page-context.md)

18. **Retry saving without losing page text.** Keep unsaved page content in the editor when a write fails and show a retry action associated with the current page.
   <!-- contribution: {"id": "save-error-continuity", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/save-error-continuity.md"} -->
   [Medium · Implementation brief](docs/contributions/save-error-continuity.md)

19. **Know which space is loading.** Show the destination space name during loading and retain a clear error state if it cannot be opened.
   <!-- contribution: {"id": "space-switch-feedback", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/space-switch-feedback.md"} -->
   [Medium · Implementation brief](docs/contributions/space-switch-feedback.md)

20. **Open a page predictably with the keyboard.** After opening a page from search or navigation, place focus at a predictable page heading or editor entry point without triggering an edit.
   <!-- contribution: {"id": "page-navigation-keyboard-focus", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/page-navigation-keyboard-focus.md"} -->
   [Medium · Implementation brief](docs/contributions/page-navigation-keyboard-focus.md)

21. **Explore linked pages on a local map.** Add an optional map of the current page’s incoming and outgoing wiki links. Reuse the existing backlink/link resolution instead of building a second index. Let users focus a neighbour, see its excerpt and open the page; keep unresolved links visually distinct.
   <!-- contribution: {"id": "see-which-pages-link-to-this-page", "size": "large", "goodFirstIssue": false, "guide": "docs/contributions/see-which-pages-link-to-this-page.md"} -->
   [Large · Implementation brief](docs/contributions/see-which-pages-link-to-this-page.md)

## References

- [Contribution brief index](docs/contributions/README.md)
- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Contributing](CONTRIBUTING.md)
