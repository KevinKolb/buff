# Adds ?v=<version> to the site's own CSS and JS links in every page, so
# browsers load new files right after an update instead of a saved copy.
# Run before committing a change to any .js or .css file:  python3 tools/stamp.py (from the repo folder)
import glob, re, time
v = time.strftime('%Y%m%d%H%M')
for page in glob.glob('*.html'):
    s = open(page).read()
    t = re.sub(r'((?:src|href)="(?:js|css)/[^"?]+\.(?:js|css))(\?v=\d+)?"', r'\1?v=' + v + '"', s)
    if t != s:
        open(page, 'w').write(t)
print('stamped', v)
