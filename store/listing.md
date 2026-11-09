# Chrome Web Store listing

Copy these into the Developer Dashboard when you publish Gasha.

## Store listing tab

**Name** (comes from the manifest)

Gasha: Website Blocker and Focus Timer

**Summary** (comes from the manifest, 132 characters at most)

Gasha means shield in Amharic. It blocks the sites you open out of habit and sends you to a notebook you wrote for yourself.

**Description**

Gasha, which means “shield” in Amharic, protects you from distractions that derail you from your goals. It blocks the websites you get “sucked into” through muscle memory, like reaching for your phone while working, which eats up your productive hours.

Instead of the site you reached for, Gasha opens your notebook: a page you design for yourself, full of whatever pulls you back to work.

★ Block any site, or only part of one
Add youtube.com to block all of YouTube, or reddit.com/r/all to block only that page. Gasha also catches clicks inside a site, so you cannot wander into a blocked part of it.

★ A notebook you write for yourself
Write messages in seven fonts and any color. Add sticky notes, YouTube and TikTok videos, photos of what you are working toward, and buttons that take you straight to your work. Pick lined, grid, or dotted paper.

★ Focus sessions with a password
Choose 25 minutes, 2 hours, or any length up to 24 hours. Until the timer ends, nobody can remove sites, edit the notebook, or end the session early without the password. Ask a friend or parent to set it if you want to be extra strict.

★ Hard to switch off
While a session runs, Chrome's extensions page is locked too, so Gasha cannot be turned off on impulse.

★ Private by design
Everything stays on your computer. No account, no tracking, no server. Download a backup whenever you like.

**Category:** Productivity. Pick the subcategory that fits best, such as Workflow & Planning.

**Language:** English

**Graphic assets**

| Field | File |
| --- | --- |
| Store icon (128x128) | `src/icons/icon128.png` |
| Screenshots (1280x800) | `store/screenshot-1-blocked-notebook.png`, `store/screenshot-2-notebook-editor.png`, `store/screenshot-3-focus-timer.png`, `store/screenshot-4-settings.png` |
| Small promo tile (440x280) | `store/promo-small-440x280.png` |

## Privacy tab

**Single purpose**

Gasha blocks the websites a user chooses and shows the user's own notebook page in their place, with timed focus sessions that can be locked with a password.

**Permission justifications**

| Permission | Why Gasha needs it |
| --- | --- |
| declarativeNetRequest | Redirects pages on the user's block list to the Gasha notebook before they load. Also sets the Referer header on YouTube and TikTok embeds inside the notebook, because those players refuse to load without one. |
| tabs | Reads the address of open tabs so that tabs already on a blocked site, or that move to one through in page navigation, can be sent to the notebook, and so that Chrome's extensions page can be locked during a focus session. |
| storage | Saves the block list, the notebook, and settings on the user's computer. |
| unlimitedStorage | Lets users keep photos in their notebook without running into the default storage limit. |
| alarms | Ends focus sessions on time and updates the time left shown on the toolbar badge. |
| Host permission for all sites | The user can block any website, and redirecting a page requires access to that site. |

**Remote code:** No, Gasha does not use remote code. All scripts are inside the package.

**Data usage:** Gasha does not collect any of the listed data types. Check all three certifications: no selling or transferring user data, no use for unrelated purposes, and no use for creditworthiness or lending.

**Privacy policy URL:** https://github.com/Azaria-Yonas/Gasha/blob/main/PRIVACY.md
