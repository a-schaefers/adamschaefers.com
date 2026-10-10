;;; site.el --- Build index.html: the page shell and every view's content  -*- lexical-binding: t; -*-

;; `make build' runs this from the repo root:
;;
;;   emacs -Q --batch -l site.el -f site-build
;;
;; The site is one page.  index.html is index.org exported without its
;; sections tagged :view:.  Those sections, blog.org and the blog posts go
;; into a JSON blob in the page head instead, and js/app.js renders the menu
;; and one view at a time from it.  Everything arrives with the first load,
;; so switching views never loads a page.
;;
;; Posts are blog/YYYY-MM-DD-slug.org.  The date comes from the file name, the
;; title from #+TITLE (or the slug), and the listing excerpt from #+DESCRIPTION
;; (or the post's first paragraph).  blog.org holds the blog's title, intro
;; text and #+POSTS_PER_PAGE.
;;
;; The build also writes rss.xml, a feed of every post in full.

(require 'cl-lib)
(require 'json)
(require 'ox-html)
(require 'subr-x)
(require 'xml)

(defconst site-blog-dir "blog/")
(defconst site-post-re
  "\\`\\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)-\\(.+\\)\\.org\\'")
(defconst site-default-per-page 10)
(defconst site-url "https://adamschaefers.com/")
(defconst site-module-imports
  '("js/lit/lit-html/lit-html.js"
    "js/lit/lit-html/directives/unsafe-html.js"
    "js/lit/lit-html/directive.js"
    "js/contact.js")
  "Every module js/app.js imports, directly or not, preloaded with it.")

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
                 (html . ,(site--body-html (concat "view:" id) t)))
               views)))
     "view")
    (nreverse views)))

;;; Blog

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

(defun site--posts ()
  "Every post in `site-blog-dir', newest first."
  (let (posts)
    (dolist (file (and (file-directory-p site-blog-dir)
                       (directory-files site-blog-dir nil site-post-re)))
      (string-match site-post-re file)
      (let ((date (match-string 1 file))
            (name (match-string 2 file))
            (slug (file-name-sans-extension file)))
        (with-temp-buffer
          (insert-file-contents (expand-file-name file site-blog-dir))
          (setq default-directory (expand-file-name site-blog-dir))
          (org-mode)
          (let ((excerpt (or (site--keyword "DESCRIPTION") (site--first-paragraph))))
            (push `((slug . ,slug)
                    (date . ,date)
                    (dateLabel . ,(site--date-label date))
                    (title . ,(or (site--keyword "TITLE") (site--slug-title name)))
                    (excerpt . ,(if excerpt
                                    (string-trim (org-export-string-as excerpt 'html t))
                                  ""))
                    ;; The post title is the view's h2, so the post's own
                    ;; top-level headings start at h3.
                    (html . ,(let ((org-html-toplevel-hlevel 3))
                               (site--body-html (concat "post:" slug)))))
                  posts)))))
    posts))

(defun site--blog ()
  "blog.org's title, intro and page size."
  (with-temp-buffer
    (insert-file-contents "blog.org")
    (org-mode)
    (let ((per-page (string-to-number (or (site--keyword "POSTS_PER_PAGE") ""))))
      `((title . ,(or (site--keyword "TITLE") "Blog"))
        (intro . ,(site--body-html "blog"))
        (perPage . ,(if (> per-page 0) per-page site-default-per-page))))))

;;; RSS

(defun site--absolute-urls (html)
  "HTML with its site-relative href and src attributes made absolute."
  (replace-regexp-in-string
   "\\(\\(?:href\\|src\\)=\"\\)/?\\([^\"#/][^\":]*\"\\)"
   (lambda (m) (concat (match-string 1 m) site-url (match-string 2 m)))
   html t t))

(defun site--rss-date (date)
  "\"2026-10-03\" -> \"Sat, 03 Oct 2026 12:00:00 +0000\"."
  (let ((system-time-locale "C"))
    (format-time-string "%a, %d %b %Y 12:00:00 +0000"
                        (date-to-time (concat date "T12:00:00Z")) t)))

(defun site--cdata (s)
  (concat "<![CDATA[" (string-replace "]]>" "]]]]><![CDATA[>" s) "]]>"))

(defun site--write-rss (blog posts)
  "Write rss.xml: every post, newest first, with its full text."
  (let ((title (concat (alist-get 'title blog) " · Adam Schaefers"))
        (link (concat site-url "#blog")))
    (with-temp-file "rss.xml"
      (insert "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
              "<rss version=\"2.0\" xmlns:atom=\"http://www.w3.org/2005/Atom\" xmlns:content=\"http://purl.org/rss/1.0/modules/content/\">\n"
              "<channel>\n"
              "  <title>" (xml-escape-string title) "</title>\n"
              "  <link>" link "</link>\n"
              "  <description>Posts by Adam Schaefers</description>\n"
              "  <language>en</language>\n"
              "  <atom:link href=\"" site-url "rss.xml\" rel=\"self\" type=\"application/rss+xml\"/>\n")
      ;; The newest post's date rather than the clock, so rebuilds are identical.
      (when posts
        (insert "  <lastBuildDate>" (site--rss-date (alist-get 'date (car posts))) "</lastBuildDate>\n"))
      (dolist (post posts)
        (let ((url (concat site-url "#blog/" (alist-get 'slug post))))
          (insert "  <item>\n"
                  "    <title>" (xml-escape-string (alist-get 'title post)) "</title>\n"
                  "    <link>" url "</link>\n"
                  "    <guid isPermaLink=\"true\">" url "</guid>\n"
                  "    <pubDate>" (site--rss-date (alist-get 'date post)) "</pubDate>\n"
                  "    <description>" (site--cdata (site--absolute-urls (alist-get 'excerpt post))) "</description>\n"
                  "    <content:encoded>" (site--cdata (site--absolute-urls (alist-get 'html post))) "</content:encoded>\n"
                  "  </item>\n")))
      (insert "</channel>\n</rss>\n"))))

;;; The page

(defun site--asset (file)
  "FILE's URL with a hash of its contents, so browsers refetch it when it changes."
  (format "%s?v=%s" file
          (substring (with-temp-buffer
                       (set-buffer-multibyte nil)
                       (insert-file-contents-literally file)
                       (secure-hash 'sha1 (current-buffer)))
                     0 10)))

(defun site--json (data)
  "DATA as JSON that is safe inside a <script> element."
  (let ((json-encoding-pretty-print nil))
    (string-replace "</" "<\\/" (json-encode data))))

(defun site-build ()
  "Export index.org to index.html, carrying every view's content."
  (site--with-export-settings
   (let ((posts (site--posts))
         (blog (site--blog)))
     (with-current-buffer (find-file-noselect "index.org")
       (let* ((data `((views . ,(vconcat (site--views)))
                      (blog . ,blog)
                      (posts . ,(vconcat posts))))
              (org-export-exclude-tags '("noexport" "view"))
              (org-html-head-extra
               (concat "<link rel=\"alternate\" type=\"application/rss+xml\" title=\"Adam Schaefers · Blog\" href=\"rss.xml\">\n"
                       (format "<link rel=\"stylesheet\" href=\"%s\">\n" (site--asset "nav.css"))
                       (format "<link rel=\"stylesheet\" href=\"%s\">\n" (site--asset "blog.css"))
                       "<script type=\"application/json\" id=\"site-data\">"
                       (site--json data)
                       "</script>\n"
                       (format "<script type=\"module\" src=\"%s\"></script>\n" (site--asset "js/app.js"))
                       ;; Fetch app.js's imports alongside it rather than one level at a time.
                       (mapconcat (lambda (m) (format "<link rel=\"modulepreload\" href=\"%s\">\n" m))
                                  site-module-imports "")
                       ;; The Contact view's Turnstile check loads on first visit; connect early.
                       "<link rel=\"preconnect\" href=\"https://challenges.cloudflare.com\">"))
              (org-html-preamble
               (lambda (_) "<nav id=\"site-nav\" class=\"site-nav\" aria-label=\"Main\"></nav>"))
              ;; js/app.js keeps the year current; the build year is the fallback.
              (org-html-postamble
               (lambda (_)
                 (format "<footer class=\"site-footer\">© <span id=\"year\">%s</span> adamschaefers.com</footer>"
                         (format-time-string "%Y")))))
         (random "index")
         (org-export-to-file 'html "index.html")
         (site--write-rss blog posts)
         (message "site: %d views, %d posts"
                  (length (alist-get 'views data)) (length posts)))))))

;;; site.el ends here
