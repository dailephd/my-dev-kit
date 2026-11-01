package fixtures.audit;

import java.util.List;
import static java.lang.Math.max;
import java.io.*;

public class Outer {
    public static class PublicNested {
    }
    static class PackageNested {
        class DeeperPackage {
        }
    }
    private class PrivateNested {
    }
    protected interface ProtectedNested {
    }
    public enum Mode { A, B }
    void method() {
        class Local {
        }
    }
}

class PackagePrivateTop {
}

interface Contract {
    class ImplicitPublicNested {
    }
}
