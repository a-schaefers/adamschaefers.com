;;; site.el --- Build index.html: the page shell and every view's content  -*- lexical-binding: t; -*-

;; `make build' runs this from the repo root:
;;
;;   emacs -Q --batch -l site.el -f site-build
;;
;; The site is one page.  index.html is index.org exported without its
;; sections tagged :view:.  Those sections and the collections (below) go
;; into a JSON blob in the page head instead, and js/app.js renders the menu
;; and one view at a time from it.  Everything arrives with the first load,
;; so switching views never loads a page.
;;
;; A collection is a folder of dated entries with an index file, listed and
;; paginated like a blog: the Blog (blog/, blog.org) and Off the clock
;; (off-the-clock/, off-the-clock.org).  Entries are DIR/YYYY-MM-DD-slug.org.
;; The date comes from the file name, the title from #+TITLE (or the slug),
;; and the listing excerpt from #+DESCRIPTION (or the first paragraph).  An
;; entry with #+VIDEO (and #+POSTER) is shown as that video, its text the
;; caption.  The index file holds the collection's title, intro text and
;; #+POSTS_PER_PAGE.
;;
;; The build also writes rss.xml, one feed of every collection's entries in
;; full, and sitemap.xml.

(require 'cl-lib)
(require 'json)
(require 'ox-html)
(require 'subr-x)
(require 'xml)

(defconst site-collections
  '((blog :dir "blog/" :index "blog.org" :name "Blog")
    (off-the-clock :dir "off-the-clock/" :index "off-the-clock.org" :name "Off the clock"))
  "Each collection: its route (the symbol), entry folder, index file and name.")
(defconst site-feed "rss.xml"
  "The one feed: every collection's entries, newest first.")
(defconst site-entry-re
  "\\`\\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)-\\(.+\\)\\.org\\'")
(defconst site-default-per-page 10)
(defconst site-url "https://adamschaefers.com/")
(defconst site-module-imports
  '("js/lit/lit-html/lit-html.js"
    "js/lit/lit-html/directives/unsafe-html.js"
    "js/lit/lit-html/directive.js"
    "js/contact.js"
    "js/store.js")
  "Every module js/app.js imports, directly or not. Each is preloaded with it, at
its hashed URL, and the import map sends imports there too.")

(defmacro site--with-export-settings (&rest body)
  `(let ((user-full-name "Adam Schaefers")
         (org-export-with-toc nil)
         (org-export-with-section-numbers nil)
         (org-export-with-tags nil)
         (org-export-time-stamp-file nil)
         (org-export-use-babel nil)
         (org-html-htmlize-output-type nil))
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
          (let ((excerpt (or (site--keyword "DESCRIPTION") (site--first-paragraph)))
                (video (site--keyword "VIDEO"))
                (poster (site--keyword "POSTER"))
                (image (site--keyword "IMAGE")))
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
                               (site--body-html (format "%s:%s" route slug))))
                    ,@(and video `((video . ,video)))
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

(defun site--entry-full-html (entry)
  "ENTRY's full HTML: its video, if it has one, above its text."
  (let ((video (alist-get 'video entry))
        (poster (alist-get 'poster entry)))
    (concat (if video
                (format "<p><video controls playsinline preload=\"metadata\"%s src=\"%s\"></video></p>\n"
                        (if poster (format " poster=\"%s\"" poster) "") video)
              "")
            (alist-get 'html entry))))

(defun site--write-feed (collections)
  "Write `site-feed': every entry of COLLECTIONS, newest first, in full."
  (let ((items (sort (mapcan (lambda (c)
                               (mapcar (lambda (e) (list (car c) e))
                                       (alist-get 'entries (cdr c))))
                             collections)
                     ;; Stable, so same-day entries keep collection order.
                     (lambda (a b) (string> (alist-get 'date (cadr a))
                                            (alist-get 'date (cadr b)))))))
    (with-temp-file site-feed
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
        (let ((url (format "%s#%s/%s" site-url route (alist-get 'slug entry)))
              (video (alist-get 'video entry)))
          (insert "  <item>\n"
                  "    <title>" (xml-escape-string (alist-get 'title entry)) "</title>\n"
                  "    <link>" url "</link>\n"
                  "    <guid isPermaLink=\"true\">" url "</guid>\n"
                  "    <pubDate>" (site--rss-date (alist-get 'date entry)) "</pubDate>\n"
                  "    <category>" (plist-get (alist-get route site-collections) :name) "</category>\n"
                  "    <description>" (site--cdata (site--absolute-urls (alist-get 'excerpt entry))) "</description>\n"
                  "    <content:encoded>" (site--cdata (site--absolute-urls (site--entry-full-html entry))) "</content:encoded>\n")
          (when video
            (insert (format "    <enclosure url=\"%s%s\" length=\"%d\" type=\"video/mp4\"/>\n"
                            site-url video (file-attribute-size (file-attributes video)))))
          (insert "  </item>\n")))
      (insert "</channel>\n</rss>\n"))))

;;; Share pages and link previews

;; Link previews (social media, chat apps) and search crawlers read a page's
;; HTML without running its JavaScript, and drop everything after #.  So every
;; view, product and entry also gets a small page at a real path
;; (store/index.html, off-the-clock/<slug>/index.html, ...) carrying its title,
;; description and picture, which sends people on to its #route.  The pages
;; made are listed in share-pages.txt, so the next build (and the pre-commit
;; hook) can drop the ones that are gone.
;;
;; The words and pictures come from the Org sources: a view's DESCRIPTION and
;; IMAGE properties, #+DESCRIPTION and #+IMAGE in blog.org, off-the-clock.org and
;; each entry (an entry's #+DESCRIPTION is also its listing excerpt), and a
;; product's data-share-image.  With none, the first paragraph or excerpt, a
;; travelog's poster, and `site-share-image'.

(defconst site-name "Adam Schaefers")
(defconst site-share-image "images/og.jpg"
  "The preview picture (1200x630): the profile photo, name and roles.")
(defconst site-home-views '("about" "quest-log" "slop-shelf")
  "Views shown together as the home page: no page of their own.")
(defconst site-share-list "share-pages.txt")
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
  (let ((image (concat site-url image)))
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
  "Every page to make: (PATH ROUTE TITLE DESCRIPTION IMAGE TYPE), PATH under the site root."
  (let ((fallback (site--summary (alist-get 'html (seq-find (lambda (v) (equal (alist-get 'id v) "about")) views)))))
    (append
     ;; Views, and the products in them.
     (mapcan
      (lambda (v)
        (let ((id (alist-get 'id v)) (html (alist-get 'html v)))
          (unless (member id site-home-views)
            (let ((summary (site--summary (site--first-paragraph-html html)))
                  (described (alist-get 'description v)))
              (cons (list id id (site--plain-title (alist-get 'title v))
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
                          (push (list pid pid
                                      (site--plain-title (if (string-match "<h3>\\(\\(?:.\\|\n\\)*?\\)</h3>" body) (match-string 1 body) pid))
                                      (site--summary (if (string-match "</h3>\\(\\(?:.\\|\n\\)*?\\)</p>" body) (match-string 1 body) html))
                                      picture "product")
                                products)))
                      (nreverse products)))))))
      views)
     ;; Collections, and their entries.
     (mapcan
      (lambda (c)
        (let* ((route (symbol-name (car c))) (col (cdr c)) (intro (site--summary (alist-get 'intro col))))
          (cons (list route route (site--plain-title (alist-get 'title col))
                      (cond ((not (string-empty-p (alist-get 'description col))) (alist-get 'description col))
                            ((not (string-empty-p intro)) intro)
                            (t fallback))
                      (if (string-empty-p (alist-get 'image col)) site-share-image (alist-get 'image col))
                      "website")
                (mapcar (lambda (e)
                          (let ((excerpt (site--summary (alist-get 'excerpt e))))
                            (list (concat route "/" (alist-get 'slug e)) (concat route "/" (alist-get 'slug e))
                                  (site--plain-title (alist-get 'title e))
                                  (if (string-empty-p excerpt) fallback excerpt)
                                  (or (alist-get 'image e) (alist-get 'poster e) site-share-image) "article")))
                        (append (alist-get 'entries col) nil)))))
      collections))))

(defun site--write-share-pages (pages)
  "Write PAGES as PATH/index.html, drop the ones an earlier build made that are gone,
and list them in `site-share-list'."
  (let ((old (and (file-exists-p site-share-list)
                  (split-string (with-temp-buffer (insert-file-contents site-share-list) (buffer-string)) "\n" t)))
        made)
    (pcase-dolist (`(,path ,route ,title ,description ,image ,type) pages)
      (let ((file (concat path "/index.html"))
            (url (concat site-url path "/"))
            (full (format "%s · %s" title site-name)))
        (make-directory path t)
        (with-temp-file file
          (insert "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
                  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
                  "<title>" (site--attr full) "</title>\n"
                  (site--meta full description url image (if (equal type "article") "article" "website")) "\n"
                  ;; People go on to the page itself; previews and crawlers stop here.
                  (format "<meta http-equiv=\"refresh\" content=\"0; url=/#%s\">\n" route)
                  (format "<script>location.replace('/#%s')</script>\n" route)
                  "</head>\n<body>\n"
                  (format "<p><a href=\"/#%s\">%s</a></p>\n" route (site--attr full))
                  "</body>\n</html>\n"))
        (push file made)))
    (setq made (sort made #'string<))
    (dolist (gone (seq-difference old made))
      (when (file-exists-p gone)
        (delete-file gone)
        (ignore-errors (delete-directory (file-name-directory gone)))))
    (with-temp-file site-share-list
      (insert (mapconcat #'identity made "\n") "\n"))
    made))

;;; Sitemap

(defun site--write-sitemap (pages)
  "Write sitemap.xml: the home page, and every share page (the views and
entries at real paths, which crawlers can read)."
  (with-temp-file "sitemap.xml"
    (insert "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
            "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n"
            "  <url><loc>" site-url "</loc></url>\n")
    (dolist (page pages)
      (insert "  <url><loc>" site-url (car page) "/</loc></url>\n"))
    (insert "</urlset>\n")))

;;; The page

(defun site--asset (file)
  "FILE's URL with a hash of its contents, so browsers refetch it when it changes."
  (format "%s?v=%s" file
          (substring (with-temp-buffer
                       (set-buffer-multibyte nil)
                       (insert-file-contents-literally file)
                       (secure-hash 'sha1 (current-buffer)))
                     0 10)))

(defun site--import-map ()
  "An import map sending each of `site-module-imports' to its hashed URL.
Only app.js's own URL carries a hash otherwise, so after a change a browser
could pair a new module with an old cached one that lacks what it imports."
  (let ((json-encoding-pretty-print nil))
    (json-encode
     `((imports . ,(mapcar (lambda (m) (cons (concat "./" m) (concat "./" (site--asset m))))
                           site-module-imports))))))

(defun site--json (data)
  "DATA as JSON that is safe inside a <script> element."
  (let ((json-encoding-pretty-print nil))
    (string-replace "</" "<\\/" (json-encode data))))

(defun site-build ()
  "Export index.org to index.html, carrying every view's content."
  (site--with-export-settings
   (let ((collections (mapcar (lambda (c) (cons (car c) (site--collection (car c) (cdr c))))
                              site-collections)))
     (with-current-buffer (find-file-noselect "index.org")
       (let* ((views (site--views))
              (data `((views . ,(vconcat views))
                      (collections . ,collections)
                      (feed . ,site-feed)))
              (pages (site--share-pages views collections))
              (home (site--summary (alist-get 'html (seq-find (lambda (v) (equal (alist-get 'id v) "about")) views))))
              (org-export-exclude-tags '("noexport" "view"))
              (org-html-head-extra
               (concat ;; Before any module loads: browsers ignore an import map that comes later.
                       "<script type=\"importmap\">" (site--import-map) "</script>\n"
                       ;; The home page's link preview; other pages have their own (site--share-pages).
                       (site--meta site-name home site-url site-share-image) "\n"
                       (format "<link rel=\"alternate\" type=\"application/rss+xml\" title=\"Adam Schaefers\" href=\"%s\">\n" site-feed)
                       (format "<link rel=\"stylesheet\" href=\"%s\">\n" (site--asset "nav.css"))
                       (format "<link rel=\"stylesheet\" href=\"%s\">\n" (site--asset "blog.css"))
                       (format "<link rel=\"stylesheet\" href=\"%s\">\n" (site--asset "store.css"))
                       "<script type=\"application/json\" id=\"site-data\">"
                       (site--json data)
                       "</script>\n"
                       (format "<script type=\"module\" src=\"%s\"></script>\n" (site--asset "js/app.js"))
                       ;; Fetch app.js's imports alongside it rather than one level at a time,
                       ;; at the hashed URLs the import map sends them to.
                       (mapconcat (lambda (m) (format "<link rel=\"modulepreload\" href=\"%s\">\n" (site--asset m)))
                                  site-module-imports "")
                       ;; The Contact view's Turnstile check loads on first visit; connect early.
                       "<link rel=\"preconnect\" href=\"https://challenges.cloudflare.com\">"))
              (org-html-preamble
               (lambda (_) "<nav id=\"site-nav\" class=\"site-nav\" aria-label=\"Main\"></nav>"))
              ;; js/app.js keeps the year current; the build year is the fallback.
              (org-html-postamble
               (lambda (_)
                 (format "<footer class=\"site-footer\">© <span id=\"year\">%s</span> adamschaefers.com · <a href=\"#sitemap\">Sitemap</a> · <a href=\"#privacy-policy\">Privacy</a> · <a href=\"#terms-of-service\">Terms</a></footer>"
                         (format-time-string "%Y")))))
         (random "index")
         (org-export-to-file 'html "index.html")
         (site--write-feed collections)
         (site--write-share-pages pages)
         (site--write-sitemap pages)
         (message "site: %d views, %s"
                  (length (alist-get 'views data))
                  (mapconcat (lambda (c) (format "%d %s" (length (alist-get 'entries (cdr c))) (car c)))
                             collections ", ")))))))

;;; site.el ends here
