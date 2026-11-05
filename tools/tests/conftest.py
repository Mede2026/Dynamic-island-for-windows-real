import sys
from pathlib import Path

# Permet `import ilelib` et `import analyze_video` depuis les tests.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
