# pureknowledge roadmap

## Scope

Keep the human-curated wiki and notes, existing spaces and page links, and recorded agent changes.

These are proposed, incremental improvements, not a release schedule or a list of missing core features. Keep each change small and preserve existing file formats, user data and app workflows.

## Improvements

1. **Search match excerpts.** Show a short matched passage beside each page title in search results so users can distinguish pages covering similar subjects.

2. **Search result type labels.** Label results as wiki pages, notes or directories using existing page kinds, rather than relying only on an icon.

3. **Search empty-state recovery.** Offer a clear-query action and distinguish an empty space from a search with no matches.

4. **Duplicate title guidance.** When page creation conflicts with an existing title, link to that page and retain the proposed text so it can be reused deliberately.

5. **Page path copy action.** Add a copy control beside the current page path with feedback, making it easier to reference the page in other suite work.

6. **Long breadcrumb handling.** Let deep page paths wrap or scroll without hiding the current page, and expose full names to keyboard users.

7. **Broken wiki-link styling.** Distinguish unresolved wiki links in rendered page text and show the target title without automatically creating a replacement page.

8. **Related-link empty state.** Explain how to add the first resource link and include an example label and path appropriate to the current page.

9. **Resource URL validation.** Give field-level feedback for malformed resource URLs while continuing to support the existing local-path link format.

10. **Resource link labels.** Use the saved descriptive label wherever available and expose the full destination on focus so similar links are distinguishable.

11. **Tag input normalization.** Trim extra whitespace and avoid repeated identical tags while preserving the user's chosen wording.

12. **Long title layout.** Keep long page titles readable in the editor and navigation without shifting the save or page-action controls off screen.

13. **Last-edit timestamp detail.** Expose the exact last-edit date and time alongside any relative timestamp, with a consistent timezone presentation.

14. **Agent change summary wrapping.** Allow long agent-change summaries to wrap in the review area instead of hiding the reason for an edit.

15. **Before-and-after readability.** Improve spacing and word wrapping in the existing review diff so long lines and URLs remain comparable within a narrow pane.

16. **Review filter reset.** Show active review sorting or filtering choices prominently and provide a simple reset to the default review list.

17. **Delete page context.** Name the page and its location in the existing delete confirmation and explain the current treatment of any child pages or links.

18. **Save error continuity.** Keep unsaved page content in the editor when a write fails and show a retry action associated with the current page.

19. **Space switch feedback.** Show the destination space name during loading and retain a clear error state if it cannot be opened.

20. **Page navigation keyboard focus.** After opening a page from search or navigation, place focus at a predictable page heading or editor entry point without triggering an edit.

## References

- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Current implementation](src/App.tsx)
