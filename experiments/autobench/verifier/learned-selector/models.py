"""Small learners in plain numpy (no new dependencies): L2 logistic regression (Newton), histogram gradient-boosted
depth-limited trees on log loss, and a listwise conditional logit (softmax over the candidates of one task).
Every fit is deterministic."""
import numpy as np


class Standardizer:
    def fit(self, X):
        self.mu = X.mean(0)
        sd = X.std(0)
        self.sd = np.where(sd > 1e-9, sd, 1.0)
        self.keep = sd > 1e-9
        return self

    def transform(self, X):
        Z = (X - self.mu) / self.sd
        Z[:, ~self.keep] = 0.0
        return np.clip(Z, -8, 8)


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -35, 35)))


class LogReg:
    """min  sum_i logloss_i + (1 / (2C)) ||w||^2   (intercept unpenalised), on standardized features."""

    def __init__(self, C=0.1, iters=50):
        self.C, self.iters = C, iters

    def fit(self, X, y, w=None):
        self.st = Standardizer().fit(X)
        Z = self.st.transform(X)
        n, d = Z.shape
        A = np.hstack([np.ones((n, 1)), Z])
        sw = np.ones(n) if w is None else np.asarray(w, float)
        beta = np.zeros(d + 1)
        p0 = np.clip((sw * y).sum() / sw.sum(), 1e-3, 1 - 1e-3)
        beta[0] = np.log(p0 / (1 - p0))
        reg = np.full(d + 1, 1.0 / self.C)
        reg[0] = 0.0
        for _ in range(self.iters):
            p = _sigmoid(A @ beta)
            g = A.T @ (sw * (p - y)) + reg * beta
            H = (A * (sw * p * (1 - p))[:, None]).T @ A + np.diag(reg) + 1e-8 * np.eye(d + 1)
            step = np.linalg.solve(H, g)
            beta -= step
            if np.abs(step).max() < 1e-7:
                break
        self.beta = beta
        return self

    def decision(self, X):
        Z = self.st.transform(X)
        return self.beta[0] + Z @ self.beta[1:]

    def predict_proba(self, X):
        return _sigmoid(self.decision(X))

    def coef(self):
        return self.beta[1:]


class GBM:
    """Gradient boosting on log loss with histogram trees of depth `depth` (Newton leaf values, L2 on leaves)."""

    def __init__(self, n_estimators=150, depth=2, lr=0.05, min_leaf=8, lam=1.0, bins=32):
        self.n, self.depth, self.lr, self.min_leaf, self.lam, self.bins = n_estimators, depth, lr, min_leaf, lam, bins

    def _bin(self, X):
        B = np.zeros(X.shape, dtype=np.int16)
        for j in range(X.shape[1]):
            B[:, j] = np.searchsorted(self.edges[j], X[:, j], side='right')
        return B

    def fit(self, X, y):
        X = np.asarray(X, float)
        self.edges = []
        for j in range(X.shape[1]):
            qs = np.unique(np.quantile(X[:, j], np.linspace(0, 1, self.bins + 1)[1:-1]))
            self.edges.append(qs)
        B = self._bin(X)
        p0 = np.clip(y.mean(), 1e-3, 1 - 1e-3)
        self.f0 = np.log(p0 / (1 - p0))
        F = np.full(len(y), self.f0)
        self.trees = []
        for _ in range(self.n):
            p = _sigmoid(F)
            g, h = p - y, np.maximum(p * (1 - p), 1e-6)
            tree = self._grow(B, g, h, np.arange(len(y)), 0)
            self.trees.append(tree)
            F += self.lr * self._apply(tree, B)
        return self

    def _leaf(self, g, h):
        return {'v': float(-g.sum() / (h.sum() + self.lam))}

    def _grow(self, B, g, h, idx, depth):
        if depth >= self.depth or len(idx) < 2 * self.min_leaf:
            return self._leaf(g[idx], h[idx])
        G, H = g[idx].sum(), h[idx].sum()
        parent = G * G / (H + self.lam)
        best = (0.0, None, None)
        for j in range(B.shape[1]):
            nb = len(self.edges[j]) + 1
            if nb < 2:
                continue
            bj = B[idx, j]
            gs = np.bincount(bj, weights=g[idx], minlength=nb)
            hs = np.bincount(bj, weights=h[idx], minlength=nb)
            cs = np.bincount(bj, minlength=nb)
            gl, hl, cl = np.cumsum(gs)[:-1], np.cumsum(hs)[:-1], np.cumsum(cs)[:-1]
            gr, hr, cr = G - gl, H - hl, len(idx) - cl
            ok = (cl >= self.min_leaf) & (cr >= self.min_leaf)
            if not ok.any():
                continue
            gain = gl * gl / (hl + self.lam) + gr * gr / (hr + self.lam) - parent
            gain = np.where(ok, gain, -np.inf)
            t = int(np.argmax(gain))
            if gain[t] > best[0] + 1e-12:
                best = (float(gain[t]), j, t)
        if best[1] is None:
            return self._leaf(g[idx], h[idx])
        j, t = best[1], best[2]
        left = idx[B[idx, j] <= t]
        right = idx[B[idx, j] > t]
        return {'j': j, 't': t, 'gain': best[0], 'l': self._grow(B, g, h, left, depth + 1),
                'r': self._grow(B, g, h, right, depth + 1)}

    def _apply(self, tree, B):
        out = np.zeros(B.shape[0])
        stack = [(tree, np.arange(B.shape[0]))]
        while stack:
            node, idx = stack.pop()
            if 'v' in node:
                out[idx] = node['v']
                continue
            m = B[idx, node['j']] <= node['t']
            stack.append((node['l'], idx[m]))
            stack.append((node['r'], idx[~m]))
        return out

    def decision(self, X, m=None):
        B = self._bin(np.asarray(X, float))
        F = np.full(B.shape[0], self.f0)
        for t in self.trees[:m]:
            F += self.lr * self._apply(t, B)
        return F

    def staged_proba(self, X, stages):
        """Probabilities after each number of trees in `stages` (ascending), in one pass."""
        B = self._bin(np.asarray(X, float))
        F = np.full(B.shape[0], self.f0)
        out, k = {}, 0
        for i, t in enumerate(self.trees, 1):
            F += self.lr * self._apply(t, B)
            if k < len(stages) and i == stages[k]:
                out[stages[k]] = _sigmoid(F.copy())
                k += 1
        return out

    def predict_proba(self, X):
        return _sigmoid(self.decision(X))

    def importance(self, d):
        imp = np.zeros(d)
        def walk(n):
            if 'v' in n:
                return
            imp[n['j']] += n['gain']
            walk(n['l']); walk(n['r'])
        for t in self.trees:
            walk(t)
        return imp


class CondLogit:
    """Listwise model for selection: P(candidate i is a pass | task) = softmax_i(w . x_i), trained on tasks with at
    least one pass and one fail (all passing candidates share the target mass). L2 on w, plain gradient descent with
    backtracking; standardized features."""

    def __init__(self, C=0.1, iters=500):
        self.C, self.iters = C, iters

    def fit(self, X, y, groups):
        self.st = Standardizer().fit(X)
        Z = self.st.transform(X)
        gl = []
        for gid in np.unique(groups):
            ix = np.where(groups == gid)[0]
            yy = y[ix]
            if yy.min() == yy.max():
                continue
            gl.append((ix, yy / yy.sum()))
        d = Z.shape[1]
        w = np.zeros(d)

        def loss_grad(w):
            L, G = 0.5 / self.C * w @ w, w / self.C
            for ix, t in gl:
                s = Z[ix] @ w
                s = s - s.max()
                e = np.exp(s)
                p = e / e.sum()
                L -= (t * np.log(p + 1e-300)).sum()
                G += Z[ix].T @ (p - t)
            return L, G
        lr = 0.1
        L, G = loss_grad(w)
        for _ in range(self.iters):
            while True:
                w2 = w - lr * G
                L2, G2 = loss_grad(w2)
                if L2 <= L - 1e-4 * lr * (G @ G) or lr < 1e-8:
                    break
                lr *= 0.5
            if abs(L - L2) < 1e-9:
                w, L, G = w2, L2, G2
                break
            w, L, G = w2, L2, G2
            lr *= 1.5
        self.w = w
        return self

    def decision(self, X):
        return self.st.transform(X) @ self.w
