;;; site.el --- Build index.html: the page shell and every view's content  -*- lexical-binding: t; -*-

;; `make build' runs this from the repo root:
;;
;;   emacs -Q --batch -l site.el -f site-build
;;
;; The site is one page.  index.html is content/index.org exported without its
;; sections tagged :view:.  Those sections and the collections (below) go
;; into a JSON blob in the page head instead, and src/app.ts renders the menu
;; and one view at a time from it.  Everything arrives with the first load,
;; so switching views never loads a page.  Each view still has an address of
;; its own (/store/, /blog/<slug>/), where the build writes the same page
;; with that view's title and link preview (see "Pages" below).
;;
;; A collection is a folder of dated entries with an index file, listed and
;; paginated like a blog: the Blog (content/blog/, content/blog.org) and Off the
;; clock (content/off-the-clock/, content/off-the-clock.org).  Entries are
;; DIR/YYYY-MM-DD-slug.org.
;; The date comes from the file name, the title from #+TITLE (or the slug),
;; and the listing excerpt from #+DESCRIPTION (or the first paragraph).  An
;; entry with #+VIDEO (and #+POSTER) is shown as that video, its text the
;; caption.  A post's #+FEATURED picture or video stands beside its opening
;; text, its #+DESCRIPTION under it, and its listing shows it small: the picture, or the video's poster
;; (#+POSTER, or the video's own address ending .jpg, which /admin uploads with
;; it).  The index file holds the collection's title, intro text and
;; #+POSTS_PER_PAGE.
;;
;; The build also writes rss.xml, one feed of every collection's entries in
;; full, and sitemap.xml.  Everything it writes goes to build/ (`site-out'),
;; beside the script and styles scripts/build.ts compiled there, and
;; scripts/dist.sh assembles public/, what the site serves, from that and
;; static/.  Videos aren't in git: they are uploaded at /admin
;; to R2 and named by their address there (#+VIDEO:
;; https://media.adamschaefers.com/evia.mp4), which also gives the feed their
;; size.

(require 'cl-lib)
(require 'json)
(require 'ox-html)
(require 'subr-x)
(require 'url)
(require 'xml)

(defconst site-content "content/"
  "The Org sources: index.org, and each collection's index file and folder.")
(defconst site-out "build/"
  "Where everything built goes (git ignores it): the pages, the feed, the sitemap,
`site-asset-list' and `site-share-list', beside the script and styles
scripts/build.ts compiled there.  scripts/dist.sh assembles public/ from it.")
(defconst site-collections
  '((blog :dir "content/blog/" :index "content/blog.org" :name "Blog")
    (off-the-clock :dir "content/off-the-clock/" :index "content/off-the-clock.org" :name "Off the clock"))
  "Each collection: its route (the symbol), entry folder, index file and name.
Entries are served at /<route>/<slug>/, and the folder's other files (a
travelog's poster) at /<route>/<file>.")
(defconst site-feed "rss.xml"
  "The one feed: every collection's entries, newest first.")
(defconst site-entry-re
  "\\`\\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)-\\(.+\\)\\.org\\'")
(defconst site-default-per-page 10)
(defconst site-url "https://adamschaefers.com/")
(defconst site-asset-list "assets.txt"
  "The styles, scripts and fonts given hashed names this build, one \"FILE HASHED\"
a line in `site-out', for make dist to publish under those names.")
(defconst site-script "build/js/app.js"
  "The page's script: src/app.ts and everything it imports, lit-html included, bundled
by scripts/build.ts (make build runs it first).  Published as js/app.<hash>.js.")
(defconst site-style "build/site.css"
  "The page's styles: src/site.css and the Tailwind utilities the templates use (src/
and this file), compiled by scripts/build.ts.  Published as site.<hash>.css, from
`site-style-out'.")
(defconst site-style-out "build/site.hashed.css"
  "`site-style' with its fonts at their hashed names (`site--style').")
(defconst site-fonts
  '(("node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2"
     . "fonts/bricolage-grotesque-latin.woff2")
    ("node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-standard-normal.woff2"
     . "fonts/bricolage-grotesque-latin-ext.woff2")
    ("node_modules/country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2"
     . "fonts/TwemojiCountryFlags.woff2"))
  "The fonts (FILE . NAME), each from its npm package (static/fonts/README.md): site.css
names it /NAME, and `site--style' publishes it under a hashed name instead.")
(defconst site-font-preload "fonts/bricolage-grotesque-latin.woff2"
  "The font every page needs (its NAME in `site-fonts'), fetched along with the page.")

(defconst site-inline-media-rules
  (let ((media "\\.\\(jpe?g\\|png\\|gif\\|webp\\|avif\\|mp4\\|webm\\|m4v\\)\\'"))
    `(("file" . ,media) ("http" . ,media) ("https" . ,media)))
  "Links Org shows in place rather than as links: a link with no description to a
picture ([[file:blog/photo.jpg]], [[https://media.adamschaefers.com/photo.jpg]]),
or to a video, which plays there (`site--format-media').")

(defvar site--posters (make-hash-table :test #'equal)
  "Each video's poster address, or nil when it has none, asked once per build.")

(defun site--poster (video)
  "VIDEO's poster: its address ending .jpg (the admin uploads it beside the video),
when that answers; nil otherwise."
  (let ((poster (concat (file-name-sans-extension video) ".jpg")))
    (with-memoization (gethash video site--posters)
      (and (string-match-p "\\`https?://" video) (site--remote-size poster) poster))))

(defun site--format-media (format source attributes info)
  "Org's picture in place (FORMAT, `org-html--format-image', with SOURCE, ATTRIBUTES
and INFO), lazily loaded; or for a video, a player with its poster.  A picture's
or video's #+ATTR_HTML :class reaches it (wide: `site--alternate-figures')."
  (if (site--video-p source)
      (let ((poster (site--poster source))
            (class (plist-get attributes :class)))
        (format "<video controls playsinline preload=\"metadata\" src=\"%s\"%s%s></video>"
                (site--attr source)
                (if poster (format " poster=\"%s\"" (site--attr poster)) "")
                (if class (format " class=\"%s\"" (site--attr class)) "")))
    (funcall format source (org-combine-plists '(:loading "lazy") attributes) info)))
(advice-add 'org-html--format-image :around #'site--format-media)

(defun site--alternate-figures (html right-first)
  "HTML with each picture or video Org set apart (a div.figure) floated to a side
by turns (right first when RIGHT-FIRST, else left: a post's featured one is on
the right), so the text runs beside them; site.css stacks them on narrow screens.
One whose picture has the class wide (#+ATTR_HTML: :class wide) spans the column
and takes no turn.  Each starts below everything before it (a div.figure-clear
ahead of it, or ahead of its heading when it opens a section), so the text that
follows it starts beside it, not beside the one before."
  (let ((turn (if right-first 0 1))
        (start 0)
        parts)
    (while (string-match "<div\\(?: id=\"[^\"]*\"\\)? class=\"figure\">" html start)
      (let* ((open (match-string 0 html))
             (from (match-beginning 0))
             (to (match-end 0))
             (body (substring html to (or (string-search "</div>" html to) (length html))))
             (side (if (string-match-p "class=\"\\(?:[^\"]* \\)?wide[\" ]" body)
                       "wide"
                     (prog1 (if (cl-evenp turn) "right" "left") (cl-incf turn)))))
        (let ((clear (if (equal side "wide") from (site--section-start html start from))))
          (push (substring html start clear) parts)
          (unless (equal side "wide") (push "<div class=\"figure-clear\"></div>" parts))
          (push (substring html clear from) parts))
        (push (string-replace "class=\"figure\"" (format "class=\"figure %s\"" side) open) parts)
        (setq start to)))
    (push (substring html start) parts)
    (apply #'concat (nreverse parts))))

(defun site--section-start (html start from)
  "Where the heading starts that HTML's figure at FROM opens the section of (only
tags between them), if it is after START; else FROM."
  (let ((before (substring html start from))
        heading)
    (if (not (string-match "</h[3-6]>\\(?:\\s-\\|<[^>]*>\\)*\\'" before))
        from
      (let ((close (match-beginning 0)) (i 0))
        (while (and (string-match "<h[3-6][ >]" before i) (< (match-beginning 0) close))
          (setq heading (match-beginning 0) i (match-end 0)))
        (if heading (+ start heading) from)))))

(defmacro site--with-export-settings (&rest body)
  `(let ((user-full-name "Adam Schaefers")
         (org-export-with-toc nil)
         (org-export-with-section-numbers nil)
         (org-export-with-tags nil)
         (org-export-time-stamp-file nil)
         (org-export-use-babel nil)
         (org-html-htmlize-output-type nil)
         (org-html-inline-image-rules site-inline-media-rules))
     ,@body))

(defun site--keyword (key)
  "Value of #+KEY in the current Org buffer, or nil if unset or empty."
  (let ((value (cadr (assoc key (org-collect-keywords (list key))))))
    (and value (not (string-empty-p value)) value)))

(defun site--body-html (seed &optional subtreep)
  "The current buffer (or subtree) as body-only HTML.
Org's heading ids are random; SEED keeps them the same from build to build."
  (random seed)
  (string-trim (org-export-as 'html subtreep nil t)))

;;; index.org's views

(defun site--views ()
  "The :view: sections of the current buffer, in order."
  (let (views)
    (org-map-entries
     (lambda ()
       (let ((id (org-entry-get nil "CUSTOM_ID")))
         (push `((id . ,id)
                 (title . ,(org-get-heading t t t t))
                 (html . ,(site--body-html (concat "view:" id) t))
                 ;; Its link preview: the heading's DESCRIPTION and IMAGE properties.
                 (description . ,(or (org-entry-get nil "DESCRIPTION") ""))
                 (image . ,(or (org-entry-get nil "IMAGE") "")))
               views)))
     "view")
    (nreverse views)))

;;; Collections

(defun site--slug-title (slug)
  "\"my-first-post\" -> \"My first post\"."
  (let ((s (replace-regexp-in-string "-" " " slug)))
    (concat (upcase (substring s 0 1)) (substring s 1))))

(defun site--first-paragraph ()
  "Org source of the current buffer's first paragraph, or nil."
  (when-let* ((p (org-element-map (org-element-parse-buffer) 'paragraph
                   #'identity nil t))
              (beg (org-element-property :contents-begin p)))
    (string-trim (buffer-substring-no-properties
                  beg (org-element-property :contents-end p)))))

(defun site--date-label (date)
  "\"2026-10-03\" -> \"October 3, 2026\"."
  (let ((system-time-locale "C"))
    (format-time-string "%B %-d, %Y" (date-to-time (concat date "T12:00:00")))))

(defun site--new-tab (link _backend _info)
  "Open LINK in a new tab if it leaves the site."
  (replace-regexp-in-string "\\`<a href=\"\\(https?:\\)"
                            "<a target=\"_blank\" rel=\"noopener\" href=\"\\1" link t))

(defun site--video-p (address)
  "Whether ADDRESS names a video (by its extension)."
  (string-match-p "\\.\\(mp4\\|webm\\|m4v\\|mov\\)\\'" address))

(defun site--entries (route dir)
  "Every entry in DIR, newest first.  ROUTE seeds their heading ids."
  (let ((org-export-filter-link-functions '(site--new-tab))
        entries)
    (dolist (file (and (file-directory-p dir)
                       (directory-files dir nil site-entry-re)))
      (string-match site-entry-re file)
      (let ((date (match-string 1 file))
            (name (match-string 2 file))
            (slug (file-name-sans-extension file)))
        (with-temp-buffer
          (insert-file-contents (expand-file-name file dir))
          (setq default-directory (expand-file-name dir))
          (org-mode)
          (let* ((description (site--keyword "DESCRIPTION"))
                 (excerpt (or description (site--first-paragraph)))
                 (video (site--keyword "VIDEO"))
                 (featured (site--keyword "FEATURED"))
                 (poster (or (site--keyword "POSTER")
                             (and featured (site--video-p featured)
                                  (concat (file-name-sans-extension featured) ".jpg"))))
                 ;; Link previews want a JPEG or PNG.
                 (image (or (site--keyword "IMAGE")
                            (and featured (string-match-p "\\.\\(jpe?g\\|png\\)\\'" featured) featured))))
            (push `((slug . ,slug)
                    (date . ,date)
                    (dateLabel . ,(site--date-label date))
                    (title . ,(or (site--keyword "TITLE") (site--slug-title name)))
                    (excerpt . ,(if excerpt
                                    (string-trim (org-export-string-as excerpt 'html t))
                                  ""))
                    ;; The entry title is the view's h2, so the entry's own
                    ;; top-level headings start at h3.
                    (html . ,(let ((org-html-toplevel-hlevel 3))
                               (site--alternate-figures (site--body-html (format "%s:%s" route slug))
                                                        (not featured))))
                    ,@(and video `((video . ,video)))
                    ,@(and featured `((featured . ,featured)))
                    ;; Under the featured picture: the description, never the
                    ;; first paragraph, which is right beside it.
                    ,@(and featured description
                           `((caption . ,(string-trim (org-export-string-as description 'html t)))))
                    ,@(and poster `((poster . ,poster)))
                    ,@(and image `((image . ,image))))
                  entries)))))
    entries))

(defun site--collection (route plist)
  "Collection ROUTE: its index file's title, intro and page size, and entries."
  (with-temp-buffer
    (insert-file-contents (plist-get plist :index))
    (org-mode)
    (let ((per-page (string-to-number (or (site--keyword "POSTS_PER_PAGE") ""))))
      `((title . ,(or (site--keyword "TITLE") (plist-get plist :name)))
        (description . ,(or (site--keyword "DESCRIPTION") ""))
        (image . ,(or (site--keyword "IMAGE") ""))
        (intro . ,(site--body-html (symbol-name route)))
        (perPage . ,(if (> per-page 0) per-page site-default-per-page))
        (entries . ,(vconcat (site--entries route (plist-get plist :dir))))))))

;;; RSS

(defun site--absolute-urls (html)
  "HTML with its site-relative href, src and poster attributes made absolute."
  (replace-regexp-in-string
   "\\(\\(?:href\\|src\\|poster\\)=\"\\)/?\\([^\"#/][^\":]*\"\\)"
   (lambda (m) (concat (match-string 1 m) site-url (match-string 2 m)))
   html t t))

(defun site--rss-date (date)
  "\"2026-10-03\" -> \"Sat, 03 Oct 2026 12:00:00 +0000\"."
  (let ((system-time-locale "C"))
    (format-time-string "%a, %d %b %Y 12:00:00 +0000"
                        (date-to-time (concat date "T12:00:00Z")) t)))

(defun site--cdata (s)
  (concat "<![CDATA[" (string-replace "]]>" "]]]]><![CDATA[>" s) "]]>"))

(defun site--entry-video (entry)
  "ENTRY's video: a travelog's, or a post's featured one."
  (or (alist-get 'video entry)
      (let ((featured (alist-get 'featured entry)))
        (and featured (site--video-p featured) featured))))

(defun site--entry-full-html (entry)
  "ENTRY's full HTML: its video or featured picture, if it has one, above its text."
  (let ((video (site--entry-video entry))
        (featured (alist-get 'featured entry))
        (poster (alist-get 'poster entry)))
    (concat (cond (video
                   (format "<p><video controls playsinline preload=\"metadata\"%s src=\"%s\"></video></p>\n"
                           (if poster (format " poster=\"%s\"" poster) "") video))
                  (featured (format "<p><img src=\"%s\" alt=\"\"></p>\n" featured))
                  (t ""))
            (alist-get 'html entry))))

(defun site--url (path)
  "PATH as an address: itself when it already is one, else under `site-url'."
  (if (string-match-p "\\`https?://" path) path (concat site-url path)))

(defun site--remote-size (url)
  "URL's size in bytes, asked of the server with a HEAD request; nil when it
doesn't answer 200."
  (let ((url-request-method "HEAD")
        (url-show-status nil)
        (case-fold-search t))
    (condition-case nil
        (let ((buffer (url-retrieve-synchronously url t t 30)))
          (when buffer
            (with-current-buffer buffer
              (goto-char (point-min))
              (prog1 (and (looking-at "HTTP/[0-9.]+ 200")
                          (re-search-forward "^content-length: *\\([0-9]+\\)" nil t)
                          (string-to-number (match-string 1)))
                (kill-buffer)))))
      (error nil))))

(defun site--video-size (video)
  "VIDEO's size in bytes, from wherever it is served (an upload at /admin).
Missing is an error in CI; a local build without the network writes 0."
  (or (site--remote-size (site--url video))
      (if (getenv "CI")
          (error "site: %s doesn't answer; upload it at https://adamschaefers.com/admin/" (site--url video))
        (message "site: %s doesn't answer, so the feed gives it length 0" (site--url video))
        0)))

(defun site--write-feed (collections)
  "Write `site-feed': every entry of COLLECTIONS, newest first, in full."
  (let ((items (sort (mapcan (lambda (c)
                               (mapcar (lambda (e) (list (car c) e))
                                       (alist-get 'entries (cdr c))))
                             collections)
                     ;; Stable, so same-day entries keep collection order.
                     (lambda (a b) (string> (alist-get 'date (cadr a))
                                            (alist-get 'date (cadr b)))))))
    (with-temp-file (site--out site-feed)
      (insert "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
              "<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\">\n"
              "<channel>\n"
              "  <title>Adam Schaefers</title>\n"
              "  <link>" site-url "</link>\n"
              "  <description>Posts and travelogs by Adam Schaefers</description>\n"
              "  <language>en</language>\n"
              "  <atom:link href=\"" site-url site-feed "\" rel=\"self\" type=\"application/rss+xml\"/>\n")
      ;; The newest entry's date rather than the clock, so rebuilds are identical.
      (when items
        (insert "  <lastBuildDate>" (site--rss-date (alist-get 'date (cadr (car items)))) "</lastBuildDate>\n"))
      (pcase-dolist (`(,route ,entry) items)
        (let ((url (format "%s%s/%s/" site-url route (alist-get 'slug entry)))
              ;; The address an entry had when views were #routes: readers know
              ;; entries by it, and would show them all again were it to change.
              (guid (format "%s#%s/%s" site-url route (alist-get 'slug entry)))
              (video (site--entry-video entry)))
          (insert "  <item>\n"
                  "    <title>" (xml-escape-string (alist-get 'title entry)) "</title>\n"
                  "    <link>" url "</link>\n"
                  "    <guid isPermaLink=\"false\">" guid "</guid>\n"
                  "    <pubDate>" (site--rss-date (alist-get 'date entry)) "</pubDate>\n"
                  "    <category>" (plist-get (alist-get route site-collections) :name) "</category>\n"
                  "    <description>" (site--cdata (site--absolute-urls (alist-get 'excerpt entry))) "</description>\n"
                  "    <content:encoded>" (site--cdata (site--absolute-urls (site--entry-full-html entry))) "</content:encoded>\n")
          (when video
            (insert (format "    <enclosure url=\"%s\" length=\"%d\" type=\"video/mp4\"/>\n"
                            (site--url video) (site--video-size video))))
          (insert "  </item>\n")))
      (insert "</channel>\n</rss>\n"))))

;;; Pages and link previews

;; Link previews (social media, chat apps) and search crawlers read a page's
;; HTML without running its JavaScript, and drop everything after #.  So every
;; view, product, entry and page of a listing has an address of its own, and
;; the build writes the page there (build/store/index.html,
;; build/off-the-clock/<slug>/index.html, ...): index.html again, with that view's
;; title, description and picture.  src/app.ts shows the view an address names,
;; and links between views switch in place, so the address bar always holds
;; an address that previews right.  The page has <base href="/">, so its
;; relative links reach the same files from every address.  404.html, the same
;; again, catches any other path.  The pages made are listed in
;; build/share-pages.txt, which scripts/dist.sh copies from.
;;
;; The words and pictures come from the Org sources: a view's DESCRIPTION and
;; IMAGE properties, #+DESCRIPTION and #+IMAGE in blog.org, off-the-clock.org and
;; each entry (an entry's #+DESCRIPTION is also its listing excerpt), and a
;; product's data-share-image.  With none, the first paragraph or excerpt, a
;; travelog's poster, and `site-share-image'.

(defconst site-name "Adam Schaefers")
(defconst site-tabs
  '(("quest-log" "/" "Projects" "<path d=\"M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z\"/><path d=\"M9 4v14M15 6v14\"/>")
    ("blog" "/blog/" "Blog" "<path d=\"M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z\"/><path d=\"M4 21V5M8 7h6M8 11h6\"/>")
    ("off-the-clock" "/off-the-clock/" "Off the clock" "<path d=\"M4 15v-3a8 8 0 0 1 16 0v3\"/><rect x=\"3\" y=\"14\" width=\"4\" height=\"7\" rx=\"1.5\"/><rect x=\"17\" y=\"14\" width=\"4\" height=\"7\" rx=\"1.5\"/>")
    ("store" "/store/" "Store" "<path d=\"M5 8h14l-1 12H6z\"/><path d=\"M9 8V6a3 3 0 0 1 6 0v2\"/>")
    ("inquiries" "/inquiries/" "Contact" "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"m3 7 9 6 9-6\"/>"))
  "The menu, in order: each tab's route (TABS in src/app.ts says what it shows),
address, label and icon (24x24 paths drawn with currentColor; phones show it over
the label in the bottom bar).  The first is the home page's.  The labels reach
src/app.ts in #site-data.")
(defconst site-tab-class
  (concat "flex items-center border-b-2 border-transparent py-[.4rem] text-[.95rem] font-semibold text-dust no-underline "
          "hover:text-sand aria-[current]:border-sand aria-[current]:text-sand [&>svg]:hidden "
          "phone:flex-1 phone:flex-col phone:gap-[.2rem] phone:border-b-0 phone:py-[.3rem] phone:text-[.75rem] phone:font-medium "
          "phone:font-stretch-85% phone:whitespace-nowrap phone:aria-[current]:text-turq phone:[&>svg]:block")
  "A tab's classes (Tailwind's utilities, site.css, which reads this file for them):
plain words at the top on desktop, the open one underlined; on phones, an icon over
its label in the bottom bar.")
(defconst site-share-image "images/og.jpg"
  "The preview picture (1200x630): the profile photo, name and roles.")
(defconst site-home-views '("about" "quest-log" "slop-shelf")
  "Views shown together as the home page: no page of their own.")
(defconst site-sitemap-description "Every page and post on adamschaefers.com."
  "The sitemap view's preview text (src/app.ts draws the view; no Org section).")
(defconst site-share-list "share-pages.txt")
(defconst site-page-tags "<!-- site: preview tags -->"
  "Stands in the exported page for each page's preview tags.")
(defun site--decode (text)
  "TEXT with the few HTML entities Org writes turned back into characters."
  (let ((case-fold-search nil))
    (dolist (e '(("&lt;" . "<") ("&gt;" . ">") ("&quot;" . "\"") ("&#39;" . "'") ("&nbsp;" . " ") ("&amp;" . "&")) text)
      (setq text (string-replace (car e) (cdr e) text)))))

(defun site--summary (html &optional max)
  "HTML as one plain line of at most MAX (200) characters, cut at a word."
  (let* ((max (or max 200))
         (text (string-trim (replace-regexp-in-string "[ \t\n]+" " " (site--decode (replace-regexp-in-string "<[^>]*>" " " html))))))
    (if (<= (length text) max) text
      (concat (string-trim-right (replace-regexp-in-string "[ ,;:]+[^ ]*\\'" "" (substring text 0 max))) "…"))))

(defun site--plain-title (title)
  "TITLE without the emoji in front: \"🛒 Store\" -> \"Store\", \"✉️ Inquiries\" -> \"Inquiries\"."
  (let ((text (string-trim (site--decode title))))
    ;; Up to the first letter or digit (an emoji can be several characters: ✉ and its variation selector).
    (while (and (> (length text) 0)
                (not (memq (get-char-code-property (aref text 0) 'general-category) '(Lu Ll Lt Lm Lo Nd Nl No))))
      (setq text (substring text 1)))
    (string-trim text)))

(defun site--first-paragraph-html (html)
  "The first <p> of HTML, or \"\"."
  (if (string-match "<p>\\(\\(?:.\\|\n\\)*?\\)</p>" html) (match-string 1 html) ""))

(defun site--attr (text)
  "TEXT for a double-quoted attribute."
  (replace-regexp-in-string "[&\"<>]" (lambda (c) (pcase c ("&" "&amp;") ("\"" "&quot;") ("<" "&lt;") (_ "&gt;"))) text t t))

(defun site--meta (title description url image &optional type)
  "The tags a link preview reads."
  (let ((image (site--url image)))
    (mapconcat
     #'identity
     (list (format "<meta name=\"description\" content=\"%s\">" (site--attr description))
           (format "<link rel=\"canonical\" href=\"%s\">" url)
           (format "<meta property=\"og:site_name\" content=\"%s\">" site-name)
           (format "<meta property=\"og:type\" content=\"%s\">" (or type "website"))
           (format "<meta property=\"og:title\" content=\"%s\">" (site--attr title))
           (format "<meta property=\"og:description\" content=\"%s\">" (site--attr description))
           (format "<meta property=\"og:url\" content=\"%s\">" url)
           (format "<meta property=\"og:image\" content=\"%s\">" image)
           (format "<meta property=\"og:image:alt\" content=\"%s\">" (site--attr title))
           "<meta name=\"twitter:card\" content=\"summary_large_image\">"
           (format "<meta name=\"twitter:title\" content=\"%s\">" (site--attr title))
           (format "<meta name=\"twitter:description\" content=\"%s\">" (site--attr description))
           (format "<meta name=\"twitter:image\" content=\"%s\">" image))
     "\n")))

(defun site--share-pages (views collections)
  "Every page to make: (PATH TITLE DESCRIPTION IMAGE TYPE [ADDRESS]), PATH under
the site root and the view's address in src/app.ts.  With ADDRESS, PATH is an old
address of that page (a product's /<id>/, from before /store/<id>/): the same
page, its preview naming ADDRESS, and not in the sitemap."
  (let ((fallback (site--summary (alist-get 'html (seq-find (lambda (v) (equal (alist-get 'id v) "about")) views)))))
    (append
     ;; Views, and the products in them.
     (mapcan
      (lambda (v)
        (let ((id (alist-get 'id v)) (html (alist-get 'html v)))
          (unless (member id site-home-views)
            (let ((summary (site--summary (site--first-paragraph-html html)))
                  (described (alist-get 'description v)))
              (cons (list id (site--plain-title (alist-get 'title v))
                          (cond ((not (string-empty-p described)) described)
                                ((not (string-empty-p summary)) summary)
                                (t fallback))
                          (if (string-empty-p (alist-get 'image v)) site-share-image (alist-get 'image v))
                          "website")
                    (let (products (start 0))
                      (while (string-match "<article class=\"product\" id=\"product-\\([^\"]+\\)\"\\([^>]*\\)>\\(\\(?:.\\|\n\\)*?\\)</article>" html start)
                        (let* ((pid (match-string 1 html)) (attrs (match-string 2 html)) (body (match-string 3 html))
                               (next (match-end 0))
                               (picture (if (string-match "data-share-image=\"\\([^\"]+\\)\"" attrs) (match-string 1 attrs) site-share-image)))
                          (setq start next)
                          (let ((page (list (concat id "/" pid)
                                            (site--plain-title (if (string-match "<h3>\\(\\(?:.\\|\n\\)*?\\)</h3>" body) (match-string 1 body) pid))
                                            (site--summary (if (string-match "</h3>\\(\\(?:.\\|\n\\)*?\\)</p>" body) (match-string 1 body) html))
                                            picture "product")))
                            (push page products)
                            (push (append (cons pid (cdr page)) (list (car page))) products))))
                      (nreverse products)))))))
      views)
     ;; The sitemap, which src/app.ts draws.
     (list (list "sitemap" "Sitemap" site-sitemap-description site-share-image "website"))
     ;; Collections, the later pages of their listings, and their entries.
     (mapcan
      (lambda (c)
        (let* ((route (symbol-name (car c))) (col (cdr c)) (intro (site--summary (alist-get 'intro col)))
               (title (site--plain-title (alist-get 'title col)))
               (description (cond ((not (string-empty-p (alist-get 'description col))) (alist-get 'description col))
                                  ((not (string-empty-p intro)) intro)
                                  (t fallback)))
               (image (if (string-empty-p (alist-get 'image col)) site-share-image (alist-get 'image col)))
               (pages (max 1 (ceiling (length (alist-get 'entries col)) (float (alist-get 'perPage col))))))
          (append
           (list (list route title description image "website"))
           (mapcar (lambda (n) (list (format "%s/%d" route n) (format "%s, page %d" title n) description image "website"))
                   (number-sequence 2 pages))
           (mapcar (lambda (e)
                     (let ((excerpt (site--summary (alist-get 'excerpt e))))
                       (list (concat route "/" (alist-get 'slug e))
                             (site--plain-title (alist-get 'title e))
                             (if (string-empty-p excerpt) fallback excerpt)
                             (or (alist-get 'image e) (alist-get 'poster e) site-share-image) "article")))
                   (append (alist-get 'entries col) nil)))))
      collections))))

(defun site--page (template title tags &optional path)
  "TEMPLATE (index.org's export) with TITLE and TAGS, a page's preview tags, framed
for the page at PATH (`site--frame')."
  (unless (and (string-match "<title>[^<]*</title>" template)
               (string-search site-page-tags template))
    (error "site: no <title> or %s in the exported page" site-page-tags))
  (site--frame (string-replace site-page-tags tags
                               (replace-match (concat "<title>" (site--attr title) "</title>") t t template))
               path))

;;; The frame: the menu, and the view drawn before the script runs

(defun site--nav ()
  "The menu, static HTML on every page: there before the script runs, and crawlers
read it.  src/app.ts marks the open tab (aria-current), and `site--frame' marks it
first for a page that has one.  The classes are Tailwind's (site.css)."
  (concat "<nav id=\"site-nav\" class=\"site-nav mx-auto box-border max-w-[70rem] px-8 pt-6 pb-0 phone:p-0\" aria-label=\"Main\">"
          "<div class=\"site-tabs flex justify-end gap-7 phone:fixed phone:inset-x-0 phone:bottom-0 phone:z-10 phone:justify-around phone:gap-0 phone:border-t phone:border-t-ridge phone:bg-sky/95 phone:px-0 phone:pt-[.4rem] phone:pb-[calc(.4rem+env(safe-area-inset-bottom))] phone:backdrop-blur-[8px]\">"
          (mapconcat (pcase-lambda (`(,route ,href ,label ,icon))
                       (format "<a class=\"%s\" href=\"%s\" data-route=\"%s\"><svg viewBox=\"0 0 24 24\" width=\"24\" height=\"24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">%s</svg><span>%s</span></a>"
                               site-tab-class href route icon label))
                     site-tabs "")
          "</div></nav>"))

(defvar site--sections nil
  "This build's :view: sections as src/app.ts draws them: (ID . HTML).")

(defun site--section-html (view)
  "VIEW (one of `site--views') as src/app.ts's `section' draws it: wrapped the way
Org exports a section, so site.css's rules apply."
  (let ((id (alist-get 'id view)))
    (format "<div id=\"outline-container-%s\" class=\"outline-2\"><h2>%s</h2><div class=\"outline-text-2\" id=\"text-%s\">%s</div></div>"
            id (site--attr (alist-get 'title view)) id (alist-get 'html view))))

(defun site--frame (template path)
  "TEMPLATE framed for the page at PATH, its address under the site root (\"\" for
the home page): the tab it is under marked open, and the sections it shows drawn
into <main>, so the first paint doesn't wait for the script (which draws the same
again, then takes over).  A collection's listings and entries and the sitemap are
the script's alone: their <main> stays empty, as does every page's with PATH nil
(404.html)."
  (let* ((first (and path (car (split-string path "/"))))
         (ids (cond ((null path) nil)
                    ((equal path "") site-home-views)
                    ((assoc first site--sections) (list first))))
         (empty "<main id=\"app\"></main>")
         (tab (format "data-route=\"%s\"" (if (equal path "") (caar site-tabs) first))))
    (unless (string-search empty template)
      (error "site: no %s in the exported page" empty))
    (setq template (string-replace empty (concat "<main id=\"app\">"
                                                 (mapconcat (lambda (id) (cdr (assoc id site--sections))) ids "")
                                                 "</main>")
                                   template))
    (if (and path (string-search tab template))
        (string-replace tab (concat tab " aria-current=\"page\"") template)
      template)))

(defun site--write (file text)
  "Write TEXT to FILE as UTF-8."
  (let ((coding-system-for-write 'utf-8-unix))
    (with-temp-file file (insert text))))

(defun site--out (file)
  "FILE's place under `site-out'."
  (concat site-out file))

(defun site--write-share-pages (pages template)
  "Write PAGES as PATH/index.html, each TEMPLATE with its own title and preview
tags, drop the ones an earlier build made that are gone, and list them in
`site-share-list'."
  (let ((old (and (file-exists-p (site--out site-share-list))
                  (split-string (with-temp-buffer (insert-file-contents (site--out site-share-list)) (buffer-string)) "\n" t)))
        made)
    (pcase-dolist (`(,path ,title ,description ,image ,type ,address) pages)
      (let ((file (concat path "/index.html"))
            (url (concat site-url (or address path) "/"))
            (full (format "%s · %s" title site-name)))
        (make-directory (site--out path) t)
        (site--write (site--out file) (site--page template full
                                      (site--meta full description url image (if (equal type "article") "article" "website"))
                                      (or address path)))
        (push file made)))
    (setq made (sort made #'string<))
    (dolist (gone (seq-difference old made))
      (when (file-exists-p (site--out gone))
        (delete-file (site--out gone))
        (ignore-errors (delete-directory (file-name-directory (site--out gone))))))
    (with-temp-file (site--out site-share-list)
      (insert (mapconcat #'identity made "\n") "\n"))
    made))

;;; Sitemap

(defun site--write-sitemap (pages)
  "Write sitemap.xml: the home page, and every share page (the views and
entries at real paths, which crawlers can read)."
  (with-temp-file (site--out "sitemap.xml")
    (insert "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
            "  <url><loc>" site-url "</loc></url>\n")
    (dolist (page pages)
      (unless (nth 5 page)
        (insert "  <url><loc>" site-url (car page) "/</loc></url>\n")))
    (insert "</urlset>\n")))

;;; The page

(defvar site--assets nil
  "The files given hashed names this build: (FILE . HASHED).")

(defun site--asset (file &optional name)
  "FILE's public NAME (default FILE) with a hash of FILE's contents in it:
build/js/app.js named js/app.js -> js/app.1a2b3c4d5e.js.  make dist publishes the
file under that name (`site-asset-list'), so browsers keep it for good and a
change is a new name."
  (let* ((name (or name file))
         (hash (substring (with-temp-buffer
                            (set-buffer-multibyte nil)
                            (insert-file-contents-literally file)
                            (secure-hash 'sha1 (current-buffer)))
                          0 10))
         (hashed (format "%s.%s.%s" (file-name-sans-extension name) hash (file-name-extension name))))
    (cl-pushnew (cons file hashed) site--assets :test #'equal)
    hashed))

(defun site--write-asset-list ()
  "Write `site-asset-list' from `site--assets'."
  (site--write (site--out site-asset-list)
               (mapconcat (lambda (a) (format "%s %s\n" (car a) (cdr a)))
                          (sort (copy-sequence site--assets) (lambda (a b) (string< (car a) (car b))))
                          "")))

(defun site--style ()
  "The compiled styles (`site-style') with each font of `site-fonts' at the hashed
name it is published under, written as `site-style-out', and that file's own
hashed name.  So browsers keep the fonts for good, a new version of one is a new
name, and the styles' hash follows."
  (let ((css (with-temp-buffer (insert-file-contents site-style) (buffer-string))))
    (pcase-dolist (`(,file . ,name) site-fonts)
      (unless (string-search (concat "/" name) css)
        (error "site: %s names no font /%s" site-style name))
      (setq css (string-replace (concat "/" name) (concat "/" (site--asset file name)) css)))
    (site--write site-style-out css)
    (site--asset site-style-out "site.css")))

(defun site--json (data)
  "DATA as JSON that is safe inside a <script> element."
  (let ((json-encoding-pretty-print nil))
    (string-replace "</" "<\\/" (json-encode data))))

(defun site-build ()
  "Export content/index.org to build/index.html, carrying every view's content,
and the same page at every view's address under build/."
  (site--with-export-settings
   (let ((root default-directory)
         (collections (mapcar (lambda (c) (cons (car c) (site--collection (car c) (cdr c))))
                              site-collections)))
     (make-directory site-out t)
     (with-current-buffer (find-file-noselect (concat site-content "index.org"))
       ;; The paths below are the repository's, not content/'s.
       (let* ((default-directory root)
              (views (site--views))
              (site--sections (mapcar (lambda (v) (cons (alist-get 'id v) (site--section-html v))) views))
              (data `((views . ,(vconcat views))
                      (collections . ,collections)
                      (tabs . ,(mapcar (lambda (tab) (cons (intern (car tab)) (nth 2 tab))) site-tabs))
                      (feed . ,site-feed)))
              (style (site--style))
              (preload (cdr (assoc (car (rassoc site-font-preload site-fonts)) site--assets)))
              (pages (site--share-pages views collections))
              (home (site--summary (alist-get 'html (seq-find (lambda (v) (equal (alist-get 'id v) "about")) views))))
              (org-export-exclude-tags '("noexport" "view"))
              (org-html-head-extra
               (concat ;; Each page's link preview goes here (site--page).
                       site-page-tags "\n"
                       (format "<link rel=\"alternate\" type=\"application/rss+xml\" title=\"Adam Schaefers\" href=\"%s\">\n" site-feed)
                       ;; The typeface starts downloading with the page, not once the styles ask.
                       (format "<link rel=\"preload\" href=\"%s\" as=\"font\" type=\"font/woff2\" crossorigin>\n" preload)
                       (format "<link rel=\"stylesheet\" href=\"%s\">\n" style)
                       "<script type=\"application/json\" id=\"site-data\">"
                       (site--json data)
                       "</script>\n"
                       (format "<script type=\"module\" src=\"%s\"></script>\n" (site--asset site-script "js/app.js"))))
              ;; The menu (`site--nav') and the footer frame every view.  Their classes are
              ;; Tailwind's (site.css): it reads this file for them.
              (org-html-preamble (lambda (_) (site--nav)))
              ;; src/app.ts keeps the year current; the build year is the fallback.
              (org-html-postamble
               (lambda (_)
                 (format "<footer class=\"site-footer mx-auto max-w-[70rem] px-8 pt-0 pb-12 text-center text-[.85rem] text-dust\">© <span id=\"year\">%s</span> adamschaefers.com · <a href=\"/sitemap/\">Sitemap</a> · <a href=\"/privacy-policy/\">Privacy</a> · <a href=\"/terms-of-service/\">Terms</a></footer>"
                         (format-time-string "%Y")))))
         (random "index")
         (let* ((export (org-export-as 'html))
                ;; First in the head, before anything with a relative URL (the font in
                ;; index.org's style): from every page's address, relative URLs start at
                ;; the site root.
                (template (replace-regexp-in-string "<meta charset=\"utf-8\" />\n" "\\&<base href=\"/\">\n" export t))
                (home-tags (site--meta site-name home site-url site-share-image)))
           (when (equal template export)
             (error "site: no <meta charset> in the exported page to put <base> after"))
           (site--write (site--out "index.html") (site--page template site-name home-tags ""))
           ;; Any other path (a mistyped address, an entry since removed): src/app.ts
           ;; shows Page not found.  Not a page for search engines to keep.
           (site--write (site--out "404.html") (site--page template (format "Page not found · %s" site-name)
                                               (concat "<meta name=\"robots\" content=\"noindex\">\n" home-tags)))
           (site--write-share-pages pages template))
         (site--write-feed collections)
         (site--write-sitemap pages)
         (site--write-asset-list)
         (message "site: %d views, %s"
                  (length (alist-get 'views data))
                  (mapconcat (lambda (c) (format "%d %s" (length (alist-get 'entries (cdr c))) (car c)))
                             collections ", ")))))))

;;; site.el ends here
