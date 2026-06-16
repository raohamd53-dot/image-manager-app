// app/routes/_index/route.jsx

import styles from "./styles.module.css";

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>

        <h1 className={styles.heading}>Image Upload Manager</h1>

        <p className={styles.text}>
          Manage customer uploaded images for your personalized products.
          Review, approve, and reject images directly from your Shopify Admin.
        </p>

        <div className={styles.navButtons}>
          <a className={styles.button} href="/app">
            Dashboard
          </a>
          <a className={styles.button} href="/app/orders">
            Orders
          </a>
          <a className={styles.button} href="/app/images">
            Images
          </a>
          <a className={styles.button} href="/app/settings">
            Settings
          </a>
        </div>

      </div>
    </div>
  );
}