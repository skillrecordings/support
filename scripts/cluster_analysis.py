#!/usr/bin/env python3
"""
Cluster Analysis - Natural Topic Discovery
Phase 0.2 of FAQ Mining from Front Cache

Uses HDBSCAN to discover natural topic groupings in support conversations.
Includes PCA dimensionality reduction for performance.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.cluster import HDBSCAN
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
from sklearn.metrics.pairwise import euclidean_distances

# Configuration
ARTIFACTS_DIR = Path("artifacts/phase-0/clusters")
EMBEDDINGS_PATH = Path("artifacts/phase-0/embeddings/latest/conversations.parquet")
FRONT_CACHE_DB = Path.home() / "skill" / "data" / "front-cache.db"

# Use PCA to reduce dimensions for faster clustering
PCA_DIMS = 50  # Reduce from 1536 to 50 dims

def load_embeddings():
    """Load embeddings from parquet file."""
    print(f"Loading embeddings from {EMBEDDINGS_PATH}...")
    df = pd.read_parquet(EMBEDDINGS_PATH)
    print(f"Loaded {len(df)} conversations with {len(df['embedding'].iloc[0])}-dim embeddings")
    return df

def reduce_dimensions(embeddings, n_components=PCA_DIMS):
    """Reduce dimensionality with PCA for faster clustering."""
    print(f"\nReducing dimensions from {embeddings.shape[1]} to {n_components} with PCA...")
    pca = PCA(n_components=n_components, random_state=42)
    reduced = pca.fit_transform(embeddings)
    variance_explained = float(pca.explained_variance_ratio_.sum())  # Convert to Python float
    print(f"Variance explained: {variance_explained:.1%}")
    return reduced, variance_explained

def run_clustering(embeddings, min_cluster_size=50, min_samples=10):
    """Run HDBSCAN clustering on embeddings."""
    print(f"\nRunning HDBSCAN with min_cluster_size={min_cluster_size}, min_samples={min_samples}...")
    
    clusterer = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        n_jobs=-1
    )
    
    labels = clusterer.fit_predict(embeddings)
    
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = (labels == -1).sum()
    noise_pct = n_noise / len(labels) * 100
    
    print(f"Found {n_clusters} clusters, {n_noise} noise points ({noise_pct:.1f}%)")
    
    return labels, clusterer

def calculate_metrics(embeddings, labels):
    """Calculate clustering quality metrics."""
    print("\nCalculating metrics...")
    
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = (labels == -1).sum()
    noise_pct = n_noise / len(labels) * 100
    
    # Calculate silhouette score (excluding noise)
    mask = labels != -1
    if mask.sum() > 1 and n_clusters > 1:
        sil_score = silhouette_score(embeddings[mask], labels[mask])
    else:
        sil_score = 0.0
    
    # Cluster size distribution
    unique, counts = np.unique(labels[labels != -1], return_counts=True)
    cluster_sizes = dict(zip([int(x) for x in unique], [int(x) for x in counts]))
    
    largest_cluster_size = max(counts) if len(counts) > 0 else 0
    largest_cluster_pct = largest_cluster_size / len(labels) * 100
    
    print(f"Silhouette score: {sil_score:.3f}")
    print(f"Largest cluster: {largest_cluster_pct:.1f}% of data")
    print(f"Noise points: {noise_pct:.1f}%")
    
    return {
        "silhouette_score": float(sil_score),
        "num_clusters": n_clusters,
        "noise_points": int(n_noise),
        "noise_pct": float(noise_pct),
        "largest_cluster_pct": float(largest_cluster_pct),
        "cluster_sizes": cluster_sizes
    }

def check_quality_gates(metrics):
    """Check if metrics pass quality gates."""
    issues = []
    
    if metrics["silhouette_score"] < 0.3:
        issues.append(f"silhouette_score {metrics['silhouette_score']:.3f} < 0.3")
    
    if metrics["largest_cluster_pct"] > 40:
        issues.append(f"largest_cluster {metrics['largest_cluster_pct']:.1f}% > 40%")
    
    if metrics["noise_pct"] > 20:
        issues.append(f"noise {metrics['noise_pct']:.1f}% > 20%")
    
    return len(issues) == 0, issues

def get_cluster_representatives(df, labels, embeddings, n_samples=5):
    """Get representative messages for each cluster (closest to centroid)."""
    print("\nFinding representative messages for each cluster...")
    
    representatives = {}
    unique_labels = sorted(set(labels[labels != -1]))
    
    for cluster_id in unique_labels:
        mask = labels == cluster_id
        cluster_embeddings = embeddings[mask]
        cluster_df = df[mask]
        
        # Calculate centroid
        centroid = cluster_embeddings.mean(axis=0)
        
        # Find distances to centroid
        distances = euclidean_distances([centroid], cluster_embeddings)[0]
        
        # Get closest n_samples
        closest_idx = np.argsort(distances)[:n_samples]
        
        representatives[int(cluster_id)] = {
            "messages": cluster_df.iloc[closest_idx]["first_message"].tolist(),
            "conversation_ids": cluster_df.iloc[closest_idx]["conversation_id"].tolist(),
            "distances": [float(d) for d in distances[closest_idx]]
        }
    
    return representatives

def get_tags_from_row(tags):
    """Safely extract tags from a row (handles numpy arrays and lists)."""
    if tags is None:
        return []
    if isinstance(tags, np.ndarray):
        if tags.size == 0:
            return []
        return tags.tolist()
    if isinstance(tags, list):
        return tags
    return []

def get_tag_distribution_per_cluster(df, labels):
    """Analyze existing tag distribution for each cluster."""
    print("\nAnalyzing tag distribution per cluster...")
    
    tag_stats = {}
    unique_labels = sorted(set(labels[labels != -1]))
    
    for cluster_id in unique_labels:
        mask = labels == cluster_id
        cluster_df = df[mask]
        
        # Flatten all tags
        all_tags = []
        for tags in cluster_df["tags"]:
            tag_list = get_tags_from_row(tags)
            all_tags.extend(tag_list)
        
        # Count tags
        tag_counts = {}
        for tag in all_tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1
        
        # Sort by count
        sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
        
        # Calculate coverage (what % of cluster has the top tag)
        top_tag_count = sorted_tags[0][1] if sorted_tags else 0
        coverage = top_tag_count / len(cluster_df) if len(cluster_df) > 0 else 0
        
        tag_stats[int(cluster_id)] = {
            "top_tags": [[str(t), int(c)] for t, c in sorted_tags[:10]],
            "tag_coverage": float(coverage),
            "unique_tags": len(tag_counts),
            "cluster_size": len(cluster_df)
        }
    
    return tag_stats

def generate_labels_from_tags_and_messages(representatives, tag_stats):
    """Generate cluster labels from top tags and representative messages."""
    print("\nGenerating cluster labels from tags and keywords...")
    
    labels = {}
    
    for cluster_id in representatives.keys():
        # Try to use top tag first
        top_tags = tag_stats.get(cluster_id, {}).get("top_tags", [])
        
        if top_tags and top_tags[0][1] > 5:  # If top tag has more than 5 occurrences
            label = top_tags[0][0].replace("_", " ").title()
        else:
            # Extract keywords from representative messages
            messages = representatives[cluster_id]["messages"]
            words = []
            for msg in messages[:3]:  # First 3 messages
                # Simple keyword extraction
                msg_words = msg[:200].lower().split()
                # Filter common words
                stop_words = {'the', 'a', 'an', 'is', 'was', 'are', 'were', 'i', 'you', 'my', 'your', 'to', 'for', 'of', 'and', 'in', 'on', 'with', 'this', 'that', 'it', 'be', 'have', 'has', 'had', 'can', 'would', 'like', 'just', 'if', 'me', 'we', 'us', 'as', 'at', 'but', 'not', 'so', 'do', 'does', 'did', 'will', 'when', 'what', 'how', 'all', 'from'}
                for w in msg_words:
                    w = ''.join(c for c in w if c.isalnum())
                    if len(w) > 3 and w not in stop_words:
                        words.append(w)
            
            if words:
                # Get most common word
                from collections import Counter
                common = Counter(words).most_common(2)
                label = " ".join(w[0].title() for w in common)
            else:
                label = f"Cluster {cluster_id}"
        
        labels[cluster_id] = label
        print(f"  Cluster {cluster_id}: {label}")
    
    return labels

def calculate_assignments(df, labels, embeddings):
    """Calculate cluster assignments with distance to centroid."""
    print("\nCalculating cluster assignments...")
    
    assignments = {}
    unique_labels = sorted(set(labels[labels != -1]))
    
    # Pre-calculate centroids
    centroids = {}
    for cluster_id in unique_labels:
        mask = labels == cluster_id
        centroids[cluster_id] = embeddings[mask].mean(axis=0)
    
    for i, (conv_id, cluster_id) in enumerate(zip(df["conversation_id"], labels)):
        if cluster_id == -1:
            assignments[conv_id] = {"cluster_id": -1, "distance_to_centroid": None}
        else:
            dist = float(euclidean_distances([embeddings[i]], [centroids[cluster_id]])[0][0])
            assignments[conv_id] = {"cluster_id": int(cluster_id), "distance_to_centroid": dist}
    
    return assignments

def save_outputs(version_dir, assignments, cluster_labels, representatives, tag_stats, metrics, params, pca_variance):
    """Save all output files."""
    print(f"\nSaving outputs to {version_dir}...")
    
    version_dir.mkdir(parents=True, exist_ok=True)
    
    # Save assignments
    with open(version_dir / "assignments.json", "w") as f:
        json.dump(assignments, f)
    print(f"  Saved {len(assignments)} assignments")
    
    # Build labels file with full cluster info
    labels_data = {"clusters": []}
    for cluster_id in sorted(cluster_labels.keys()):
        rep = representatives[cluster_id]
        tags = tag_stats[cluster_id]
        
        labels_data["clusters"].append({
            "id": cluster_id,
            "label": cluster_labels[cluster_id],
            "size": tags["cluster_size"],
            "representative_messages": rep["messages"],
            "top_existing_tags": tags["top_tags"][:5],
            "tag_coverage": tags["tag_coverage"]
        })
    
    with open(version_dir / "labels.json", "w") as f:
        json.dump(labels_data, f, indent=2)
    print(f"  Saved {len(labels_data['clusters'])} cluster labels")
    
    # Save metrics
    metrics_data = {
        "algorithm": "hdbscan",
        "parameters": params,
        "num_clusters": metrics["num_clusters"],
        "noise_points": metrics["noise_points"],
        "silhouette_score": metrics["silhouette_score"],
        "noise_pct": metrics["noise_pct"],
        "largest_cluster_pct": metrics["largest_cluster_pct"],
        "cluster_sizes": metrics["cluster_sizes"],
        "dimensionality_reduction": {
            "method": "PCA",
            "original_dims": 1536,
            "reduced_dims": PCA_DIMS,
            "variance_explained": pca_variance
        },
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    with open(version_dir / "metrics.json", "w") as f:
        json.dump(metrics_data, f, indent=2)
    print(f"  Saved metrics")

def main():
    # Load data
    df = load_embeddings()
    embeddings_full = np.array(df["embedding"].tolist())
    
    # Reduce dimensions for faster clustering
    embeddings, pca_variance = reduce_dimensions(embeddings_full)
    
    # Iteration tracking
    iterations = []
    max_iterations = 3
    
    # Starting parameters - adjusted for the dataset
    param_sets = [
        {"min_cluster_size": 50, "min_samples": 10},
        {"min_cluster_size": 30, "min_samples": 5},
        {"min_cluster_size": 100, "min_samples": 15},
    ]
    
    best_metrics = None
    best_labels = None
    best_version = None
    best_params = None
    
    for i, params in enumerate(param_sets):
        if i >= max_iterations:
            break
            
        print(f"\n{'='*60}")
        print(f"ITERATION {i+1}/{max_iterations}")
        print(f"{'='*60}")
        
        # Run clustering
        labels, clusterer = run_clustering(
            embeddings, 
            min_cluster_size=params["min_cluster_size"],
            min_samples=params["min_samples"]
        )
        
        # Calculate metrics
        metrics = calculate_metrics(embeddings, labels)
        
        # Check quality gates
        passed, issues = check_quality_gates(metrics)
        
        iteration_log = {
            "iteration": i + 1,
            "parameters": params,
            "metrics": {k: v for k, v in metrics.items() if k != "cluster_sizes"},
            "quality_gates_passed": passed,
            "issues": issues
        }
        iterations.append(iteration_log)
        
        if passed or (best_metrics is None) or (metrics["silhouette_score"] > best_metrics["silhouette_score"]):
            best_metrics = metrics
            best_labels = labels
            best_version = i + 1
            best_params = params
        
        if passed:
            print(f"\n✅ Quality gates PASSED!")
            break
        else:
            print(f"\n⚠️ Quality gates FAILED: {', '.join(issues)}")
            if i + 1 < max_iterations:
                print(f"Trying next parameter set...")
    
    # Use best result
    print(f"\n{'='*60}")
    print(f"USING BEST RESULT (iteration {best_version})")
    print(f"{'='*60}")
    
    labels = best_labels
    params = best_params
    metrics = best_metrics
    
    # Get representatives (use reduced embeddings)
    representatives = get_cluster_representatives(df, labels, embeddings)
    
    # Get tag distribution
    tag_stats = get_tag_distribution_per_cluster(df, labels)
    
    # Generate labels from tags and keywords
    cluster_labels = generate_labels_from_tags_and_messages(representatives, tag_stats)
    
    # Calculate assignments (use reduced embeddings for consistent distances)
    assignments = calculate_assignments(df, labels, embeddings)
    
    # Save outputs
    version_dir = ARTIFACTS_DIR / "v1"
    save_outputs(version_dir, assignments, cluster_labels, representatives, tag_stats, metrics, params, pca_variance)
    
    # Save iterations log
    with open(version_dir / "iterations.json", "w") as f:
        json.dump(iterations, f, indent=2)
    
    # Create latest symlink
    latest_link = ARTIFACTS_DIR / "latest"
    if latest_link.exists() or latest_link.is_symlink():
        latest_link.unlink()
    latest_link.symlink_to("v1")
    print(f"\nCreated symlink: latest -> v1")
    
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    print(f"Clusters found: {metrics['num_clusters']}")
    print(f"Noise points: {metrics['noise_points']} ({metrics['noise_pct']:.1f}%)")
    print(f"Silhouette score: {metrics['silhouette_score']:.3f}")
    print(f"Largest cluster: {metrics['largest_cluster_pct']:.1f}%")
    print(f"\nTop 10 clusters by size:")
    
    sorted_clusters = sorted(metrics['cluster_sizes'].items(), key=lambda x: x[1], reverse=True)[:10]
    for cluster_id, size in sorted_clusters:
        label = cluster_labels.get(int(cluster_id), f"Cluster {cluster_id}")
        print(f"  {cluster_id}: {label} ({size} conversations)")
    
    return 0 if best_metrics else 1

if __name__ == "__main__":
    sys.exit(main())
