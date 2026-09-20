import Database from "better-sqlite3";
const path=process.argv[2]??"tree.sqlite";
const db=new Database(path,{readonly:true});
try{
  console.log("KINSHIP SUMMARY");
  console.table(db.prepare(`SELECT (SELECT COUNT(*) FROM individuals) AS individuals,(SELECT COUNT(*) FROM families) AS families,(SELECT COUNT(*) FROM family_children) AS family_children,(SELECT COUNT(*) FROM kinship_edges) AS edges,(SELECT COUNT(*) FROM kinship_distance) AS persisted_queries`).all());
  console.log("EDGE TYPES AND WEIGHTS");
  console.table(db.prepare(`SELECT edge_type,weight,COUNT(*) AS edges FROM kinship_edges GROUP BY edge_type,weight ORDER BY edge_type,weight`).all());
  console.log("INTEGRITY CHECKS");
  console.table(db.prepare(`SELECT (SELECT COUNT(*) FROM kinship_edges e LEFT JOIN kinship_edges r ON r.from_id=e.to_id AND r.to_id=e.from_id AND ((e.edge_type='parent' AND r.edge_type='child') OR (e.edge_type='child' AND r.edge_type='parent') OR (e.edge_type='spouse' AND r.edge_type='spouse')) AND r.weight=e.weight WHERE r.from_id IS NULL) AS missing_reverse_edges,(SELECT COUNT(*) FROM kinship_distance WHERE a_id>=b_id) AS noncanonical_distance_pairs,(SELECT COUNT(*) FROM kinship_distance WHERE blood_degree IS NULL AND mrca_id IS NOT NULL) AS bloodless_rows_with_mrca`).all());
}finally{db.close();}
