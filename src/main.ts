import "./styles.css";
import { mockSnapshot } from "./mock";
import { render } from "./ui/render";

// TODO(#7 — branchement front/back) : remplacer le mock par invoke("get_snapshot")
// au montage, puis toutes les 30 s / a chaque ouverture de l'overlay. Le contrat
// de donnees (src/types.ts) est deja aligne avec le futur Snapshot Rust.
render(mockSnapshot);
