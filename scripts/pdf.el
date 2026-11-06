;;; pdf.el --- A post as a book's LaTeX, for make pdf  -*- lexical-binding: t; -*-

;; `make pdf' (scripts/pdf.sh) runs this from the repo root:
;;
;;   emacs -Q --batch -l scripts/pdf.el --eval '(pdf-export "content/blog/....org" "build/pdf")'
;;
;; It writes two files for scripts/pdf.tex, the book's frame, to read: body.tex, the
;; post's text as LaTeX, and meta.tex, its title, subtitle, date and picture.  The Org
;; file is the one the site is built from and is never changed: what differs in print
;; is changed here, in a copy.
;;
;; Footnotes need nothing done to them.  Org's LaTeX export sets each note where it is
;; first referred to, whatever section its definition sits under in the Org file, and
;; LaTeX puts it at the foot of that page.  They number in the order the text refers to
;; them, as on the site, so note 49 there is note 49 here.
;;
;; The book's #+AUTHOR (else Adam Schaefers) goes on the title page, the copyright page and
;; the PDF's metadata.  Its #+EDITION and #+EDITION_SOURCE (where its earlier editions are
;; kept), and its #+LICENSE and #+LICENSE_URL, go on a copyright page behind the title page.  The site
;; shows none of them: the post says its license in its own words.
;;
;; What differs from the site:
;;
;; - The contents the post writes by hand before its first heading (lists of links to
;;   its own headings, each under a bold line) are left out: LaTeX makes the book's, with
;;   page numbers.
;; - A paragraph that links to the PDF itself is left out.
;; - What else stands before the first heading (the post's opening line, under its
;;   title on the site) goes on the title page, under the subtitle.
;; - The HTML the post carries (@@html:...@@) becomes Org: a link to the site gets the
;;   site's full address, an anchor (<a id>) becomes a place links can jump to, <i> is
;;   italics.  Any other tag is an error, so a new one gets handled here on purpose.
;; - Straight quotes are set as printers' quotes, as LaTeX sets every apostrophe anyway.
;; - A table gets columns that wrap (set widths, ragged right, small type) in a
;;   longtable, which can break across pages.  Org's own choice is one line per cell,
;;   which runs off a 6x9 page.

(require 'cl-lib)
(require 'ox-latex)

(defconst pdf-site "https://adamschaefers.com"
  "The site's address, which a link to one of its pages gets in print.")

(defconst pdf--toc-item
  "^[ \t]*\\(?:-\\|[0-9]+\\.\\)[ \t]+\\(?:\\[@[0-9]+\\][ \t]+\\)?\\[\\[#[^]]+\\]\\[[^]]+\\]\\][ \t]*$"
  "A list item that is only a link to one of the post's own headings.")

(defconst pdf--table-widths '((2 0.34 0.66) (3 0.30 0.22 0.48))
  "For a table of N columns, each column's share of the line.  Others get equal shares.")

(defun pdf--set-tables ()
  "Above each table, the #+ATTR_LATEX that makes its columns wrap."
  (goto-char (point-min))
  (while (re-search-forward "^[ \t]*|" nil t)
    (beginning-of-line)
    (let* ((n (1- (cl-count ?| (buffer-substring (point) (line-end-position)))))
           (widths (or (cdr (assq n pdf--table-widths)) (make-list n (/ 1.0 n)))))
      (insert "#+ATTR_LATEX: :environment longtable :font \\small :align "
              (mapconcat
               (lambda (w)
                 (format ">{\\raggedright\\arraybackslash}p{\\dimexpr %.2f\\linewidth-2\\tabcolsep\\relax}" w))
               widths "")
              "\n"))
    (while (looking-at "^[ \t]*|") (forward-line 1))))

(defun pdf--keyword (key)
  "Value of #+KEY in the current Org buffer, or nil if unset or empty."
  (let ((value (cadr (assoc key (org-collect-keywords (list key))))))
    (and value (not (string-empty-p value)) value)))

(defun pdf--drop-contents ()
  "Delete the hand-written contents before the first heading.
That is every list item that only links to a heading, and each bold line
standing over such a list."
  (save-excursion
    (goto-char (point-min))
    (let ((end (copy-marker (if (re-search-forward "^\\*+ " nil t) (match-beginning 0) (point-max)))))
      (goto-char (point-min))
      (while (re-search-forward "^\\*[^*\n]+\\*[ \t]*\n\\(?:[ \t]*\n\\)*" end t)
        (when (save-match-data (looking-at pdf--toc-item))
          (replace-match "")))
      (goto-char (point-min))
      (while (re-search-forward pdf--toc-item end t)
        (delete-region (match-beginning 0) (min (1+ (match-end 0)) (point-max)))))))

(defun pdf--drop-paragraphs-linking (address)
  "Delete each paragraph that links to ADDRESS, a site path."
  (save-excursion
    (goto-char (point-min))
    (while (search-forward address nil t)
      (let* ((from (if (re-search-backward "^[ \t]*\n" nil t) (match-end 0) (point-min)))
             (to (progn (goto-char from)
                        (if (re-search-forward "^[ \t]*\n" nil t) (match-end 0) (point-max)))))
        (delete-region from to)))))

(defun pdf--take-opening ()
  "Delete the text between the keywords and the first heading, and return it, or nil."
  (save-excursion
    (goto-char (point-min))
    (while (looking-at "^\\(?:#\\+.*\\|[ \t]*\\)\n") (forward-line 1))
    (let* ((from (point))
           (to (if (re-search-forward "^\\*+ " nil t) (match-beginning 0) (point-max)))
           (text (string-trim (buffer-substring from to))))
      (delete-region from to)
      (unless (string-empty-p text) text))))

(defun pdf--absolute (href)
  "HREF, with the site's address before it if it is one of the site's paths."
  (if (string-prefix-p "/" href) (concat pdf-site href) href))

(defun pdf--html-to-org (html)
  "The Org for HTML, the inside of one @@html:...@@ snippet."
  (let ((org html))
    (setq org (replace-regexp-in-string
               "<a id=\"\\([^\"]+\\)\"></a>" "@@latex:\\\\hypertarget{\\1}{}@@" org t))
    (setq org (replace-regexp-in-string
               "<a href=\"\\([^\"]+\\)\">\\([^<]*\\)</a>"
               (lambda (m)
                 (format "[[%s][%s]]" (pdf--absolute (match-string 1 m)) (match-string 2 m)))
               org t t))
    (setq org (replace-regexp-in-string "</?small>" "" org t t))
    (setq org (replace-regexp-in-string "</?i>" "/" org t t))
    (when (string-match "<[^>]*>" org)
      (error "pdf: scripts/pdf.el has no Org for the HTML %s" (match-string 0 org)))
    org))

(defun pdf--html-snippets ()
  "Turn every @@html:...@@ in the buffer into Org.  Return the anchors' ids."
  (let (ids)
    (save-excursion
      (goto-char (point-min))
      (while (re-search-forward "@@html:\\(\\(?:.\\|\n\\)*?\\)@@" nil t)
        (let* ((html (match-string 1))
               (org (save-match-data
                      (when (string-match "<a id=\"\\([^\"]+\\)\">" html)
                        (push (match-string 1 html) ids))
                      (pdf--html-to-org html))))
          (replace-match org t t))))
    ids))

(defun pdf--anchor-links (ids)
  "Point each link to one of the anchors IDS at the place pdf--html-to-org made."
  (dolist (id ids)
    (save-excursion
      (goto-char (point-min))
      (while (re-search-forward (format "\\[\\[#%s\\]\\[\\([^]]+\\)\\]\\]" (regexp-quote id)) nil t)
        (replace-match (format "@@latex:\\\\hyperlink{%s}{@@\\1@@latex:}@@" id) t)))))

(defun pdf--tex (string)
  "STRING with LaTeX's special characters escaped."
  (replace-regexp-in-string "[&%$#_{}]" "\\\\\\&" string))

(defun pdf--date (file)
  "The date in FILE's name (YYYY-MM-DD-slug.org), as November 5, 2026."
  (let ((name (file-name-nondirectory file)))
    (unless (string-match "\\`\\([0-9]+\\)-\\([0-9]+\\)-\\([0-9]+\\)-" name)
      (error "pdf: %s has no date in its name" name))
    (format "%s %d, %s"
            (calendar-month-name (string-to-number (match-string 2 name)))
            (string-to-number (match-string 3 name))
            (match-string 1 name))))

(defun pdf-export (file dir)
  "Write the post FILE as body.tex and meta.tex in DIR."
  (require 'calendar)
  (let* ((file (expand-file-name file))
         (dir (file-name-as-directory (expand-file-name dir)))
         (slug (replace-regexp-in-string
                "\\`[0-9]+-[0-9]+-[0-9]+-" "" (file-name-base file)))
         ;; content/blog/x.org, or the draft content/blog/drafts/x.org: both are /blog/x/.
         (folder (directory-file-name (file-name-directory file)))
         (home (if (equal (file-name-nondirectory folder) "drafts")
                   (directory-file-name (file-name-directory folder))
                 folder))
         (collection (file-name-nondirectory home))
         (content (file-name-directory home))
         (user-full-name "Adam Schaefers")
         (org-export-use-babel nil)
         (org-latex-prefer-user-labels t)
         (org-latex-classes
          '(("book" "\\documentclass{book}"
             ("\\chapter{%s}" . "\\chapter*{%s}")
             ("\\section{%s}" . "\\section*{%s}")
             ("\\subsection{%s}" . "\\subsection*{%s}"))))
         title author featured description edition source license license-url opening body)
    (with-temp-buffer
      (insert-file-contents file)
      (org-mode)
      (setq title (or (pdf--keyword "TITLE") (error "pdf: %s has no #+TITLE" file))
            author (or (pdf--keyword "AUTHOR") user-full-name)
            featured (pdf--keyword "FEATURED")
            description (pdf--keyword "DESCRIPTION")
            edition (pdf--keyword "EDITION")
            source (pdf--keyword "EDITION_SOURCE")
            license (pdf--keyword "LICENSE")
            license-url (pdf--keyword "LICENSE_URL"))
      (pdf--drop-contents)
      (pdf--drop-paragraphs-linking (format "/%s/%s.pdf" collection slug))
      (setq opening (pdf--take-opening))
      (pdf--anchor-links (pdf--html-snippets))
      (pdf--set-tables)
      ;; The labels Org makes up are random: seeded, the same ones every run.
      (random "pdf")
      (setq body (org-export-as 'latex nil nil t
                                '(:latex-class "book" :with-toc nil :section-numbers t
                                  :with-smart-quotes t :with-special-strings nil
                                  :with-tags nil :time-stamp-file nil))))
    (make-directory dir t)
    (let ((coding-system-for-write 'utf-8-unix)
          (parts (split-string title ": ")))
      (write-region body nil (concat dir "body.tex"))
      (write-region
       (concat (format "\\newcommand{\\booktitle}{%s}\n" (pdf--tex (car parts)))
               (format "\\newcommand{\\booksubtitle}{%s}\n"
                       (pdf--tex (string-join (cdr parts) ": ")))
               (format "\\newcommand{\\bookauthor}{%s}\n" (pdf--tex author))
               (format "\\newcommand{\\bookdate}{%s}\n" (pdf--date file))
               (format "\\newcommand{\\booksite}{%s}\n"
                       (pdf--tex (replace-regexp-in-string "\\`https://" "" pdf-site)))
               ;; The opening line, under the subtitle.
               (if opening
                   (format "\\newcommand{\\bookopening}{%s}\n"
                           (string-trim (org-export-string-as opening 'latex t '(:with-smart-quotes t))))
                 "")
               ;; The title page carries #+DESCRIPTION under its picture.
               (if description (format "\\newcommand{\\bookdescription}{%s}\n" (pdf--tex description)) "")
               ;; The copyright page: #+EDITION, #+EDITION_SOURCE (an address where the
               ;; earlier editions are kept), #+LICENSE and #+LICENSE_URL.
               (if edition (format "\\newcommand{\\bookedition}{%s}\n"
                                   (replace-regexp-in-string "\"\\([^\"]*\\)\"" "``\\1''" (pdf--tex edition) t))
                 "")
               (if source (format "\\newcommand{\\bookeditionsource}{%s}\n" source) "")
               (if license (format "\\newcommand{\\booklicense}{%s}\n" (pdf--tex license)) "")
               (if license-url (format "\\newcommand{\\booklicenseurl}{%s}\n" license-url) "")
               ;; A picture, not a video: #+FEATURED is a file's site address (blog/x.jpg).
               (if (and featured (string-match-p "\\.\\(?:jpe?g\\|png\\)\\'" featured)
                        (not (string-match-p "\\`https?:" featured)))
                   (format "\\newcommand{\\bookpicture}{%s}\n"
                           (expand-file-name featured content))
                 ""))
       nil (concat dir "meta.tex")))
    (message "pdf: %s as %sbody.tex" (file-relative-name file) (file-relative-name dir))))

;;; pdf.el ends here
