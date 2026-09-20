#include <stdio.h>
#include <stdlib.h>

#define SPACE 5

struct Node {
    int data;
    struct Node *left;
    struct Node *right;
    int h;
};

struct Node *root = NULL;

/* Utility functions */

int height(struct Node *n) {
    return n ? n->h : 0;
}

int max(int a, int b) {
    return (a > b) ? a : b;
}

int balanceFactor(struct Node *n) {
    return n ? height(n->left) - height(n->right) : 0;
}

// Node creation
struct Node *createNode(int data) {
    struct Node *n = (struct Node *)malloc(sizeof(struct Node));
    n->data = data;
    n->left = n->right = NULL;
    n->h = 1;
    return n;
}

// Rotations
struct Node *rightRotation(struct Node *y) {
    struct Node *x = y->left;
    struct Node *T2 = x->right;

    x->right = y;
    y->left = T2;

    y->h = 1 + max(height(y->left), height(y->right));
    x->h = 1 + max(height(x->left), height(x->right));

    return x;
}

struct Node *leftRotation(struct Node *x) {
    struct Node *y = x->right;
    struct Node *T2 = y->left;

    y->left = x;
    x->right = T2;

    x->h = 1 + max(height(x->left), height(x->right));
    y->h = 1 + max(height(y->left), height(y->right));

    return y;
}

// Inserting a node
struct Node *insert(struct Node *node, int data) {
    if (node == NULL)
        return createNode(data);

    if (data < node->data)
        node->left = insert(node->left, data);
    else if (data > node->data)
        node->right = insert(node->right, data);
    else
        return node; // no duplicates

    node->h = 1 + max(height(node->left), height(node->right));
    int bf = balanceFactor(node);

    // LL
    if (bf > 1 && data < node->left->data)
        return rightRotation(node);

    // RR
    if (bf < -1 && data > node->right->data)
        return leftRotation(node);

    // LR
    if (bf > 1 && data > node->left->data) {
        node->left = leftRotation(node->left);
        return rightRotation(node);
    }

    // RL
    if (bf < -1 && data < node->right->data) {
        node->right = rightRotation(node->right);
        return leftRotation(node);
    }

    return node;
}

// to find minimum value node
struct Node *minValueNode(struct Node *node) {
    struct Node *current = node;
    while (current->left != NULL)
        current = current->left;
    return current;
}

// Deleting a node
struct Node *deleteNode(struct Node *node, int data) {
    if (node == NULL)
        return node;

    if (data < node->data)
        node->left = deleteNode(node->left, data);
    else if (data > node->data)
        node->right = deleteNode(node->right, data);
    else {
        // One or no child
        if (node->left == NULL || node->right == NULL) {
            struct Node *temp = node->left ? node->left : node->right;

            if (temp == NULL) {
                temp = node;
                node = NULL;
            } else {
                *node = *temp;
            }
            free(temp);
        } 
        // Two children
        else {
            struct Node *temp = minValueNode(node->right);
            node->data = temp->data;
            node->right = deleteNode(node->right, temp->data);
        }
    }

    if (node == NULL)
        return node;

    node->h = 1 + max(height(node->left), height(node->right));
    int bf = balanceFactor(node);

    // LL
    if (bf > 1 && balanceFactor(node->left) >= 0)
        return rightRotation(node);

    // LR
    if (bf > 1 && balanceFactor(node->left) < 0) {
        node->left = leftRotation(node->left);
        return rightRotation(node);
    }

    // RR
    if (bf < -1 && balanceFactor(node->right) <= 0)
        return leftRotation(node);

    // RL
    if (bf < -1 && balanceFactor(node->right) > 0) {
        node->right = rightRotation(node->right);
        return leftRotation(node);
    }

    return node;
}

// Inorder Traversals 
void inorder(struct Node *root) {
    if (root != NULL) {
        inorder(root->left);
        printf(" %d", root->data);
        inorder(root->right);
    }
}

// Printing tree
void printTree(struct Node *root, int space) {
    if (root == NULL)
        return;

    space += SPACE;
    printTree(root->right, space);

    printf("\n");
    for (int i = SPACE; i < space; i++)
        printf(" ");
    printf("%d\n", root->data);

    printTree(root->left, space);
}

// Main function
int main() {
    int ch, data;

    while (1) {
        printf("\n\n1: Insert\n2: Delete\n3: Inorder\n4: Print Tree\n5: Exit");
        printf("\nEnter your choice: ");
        scanf("%d", &ch);

        switch (ch) {
            case 1:
                printf("Enter data: ");
                scanf("%d", &data);
                root = insert(root, data);
                break;

            case 2:
                printf("Enter data to delete: ");
                scanf("%d", &data);
                root = deleteNode(root, data);
                break;

            case 3:
                inorder(root);
                break;

            case 4:
                printTree(root, 0);
                break;

            case 5:
                exit(0);

            default:
                printf("Invalid choice!");
        }
    }
    return 0;
}
