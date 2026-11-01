public class ObservationsJava {
    static final String DETECTOR_ID = "java-detector";

    @org.junit.Test
    public void runs() throws Exception {
        Runtime.getRuntime().exec("npm run build");
    }
}
